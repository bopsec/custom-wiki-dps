// noinspection FallThroughInSwitchStatementJS

import { PartialDeep } from 'type-fest';
import { v7 as uuidv7 } from 'uuid';
import type { ImportableData } from '@/state/RootStore';
import { EquipmentPiece, Player, PlayerEquipment } from '@/types/Player';
import { Monster, MonsterDefinition } from '@/types/Monster';
import { PlayerCombatStyle } from '@/types/PlayerCombatStyle';
import { spellByName } from '@/types/Spell';
import { Prayer } from '@/enums/Prayer';
import { availableEquipment } from '@/lib/Equipment';
import { CUSTOM_MONSTER_ID, INITIAL_MONSTER_INPUTS } from '@/lib/Monsters';
import { isDefined, keys } from '@/utils';
import { PlayerBuffs, PlayerPatch } from '@/state/PlayerStore';
import { availableMonsters } from '@/state/MonsterStore';

const releasedFracturedItemIds: Record<number, number> = {
  [-40001]: 34719, // Rondache
  [-40002]: 34725, // Zorya's tome (charged)
  [-40003]: 34715, // Obligator (charged)
  [-40004]: 34681, // Ascension crossbows
  [-40005]: 34684, // Ascension bolts
  [-40006]: 34696, // Diamond ascension bolts (e)
  [-40007]: 34708, // Onyx ascension bolts (e)
};

const releasedFracturedMonsterIds: Record<number, { id: number, version: string }> = {
  16660: { id: 16659, version: 'Grounded' }, // Archive Guardian
  16644: { id: 16645, version: 'Staff' }, // Dagon'hai Monk
  16674: { id: 16673, version: 'Phase 1' }, // Ocellus
};

/**
 * Bring data written by an older version of the calculator up to the current schema. Mutates and returns `data`.
 */
export const migrateImportableData = (data: ImportableData): ImportableData => {
  /* eslint-disable no-fallthrough */
  switch (data.serializationVersion) {
    case 1:
      data.monster.inputs.phase = data.monster.inputs.tormentedDemonPhase;

    case 2: // reserved: used during leagues 5
    case 3: // reserved: used during leagues 5
    case 4: // reserved: used during leagues 5
    case 5:
      // leagues 5 stored a `leagues` key on each loadout, which no longer exists on Player
      data.loadouts.forEach((l) => Reflect.deleteProperty(l, 'leagues'));

    case 6:
      // partyAvgMiningLevel becomes partySumMiningLevel
      if (isDefined(data.monster.inputs.partyAvgMiningLevel)) {
        data.monster.inputs.partySumMiningLevel = data.monster.inputs.partyAvgMiningLevel * data.monster.inputs.partySize;
        delete data.monster.inputs.partyAvgMiningLevel;
      }

    case 7:
      if (!isDefined(data.monster.immunities)) {
        data.monster.immunities = {
          burn: null,
        };
      }

    case 8: // reserved: used during leagues 6

    case 9: // reserved: used during leagues 6

    case 10:
      data.loadouts.forEach((l) => {
        // leagues had prayers beyond 20, and now we need to reuse the ids
        l.prayers = l.prayers?.filter((p) => p <= 20);
      });

    case 11: // reserved

    case 12: {
      // loadouts gained a uuid, and the selected loadout became that uuid instead of an index
      data.loadouts.forEach((l) => {
        l.uuid ??= uuidv7();
      });
      const legacySelectedIndex = data.selectedLoadout as unknown as number | undefined;
      const selected = data.loadouts[legacySelectedIndex ?? 0]?.uuid;
      if (selected) {
        data.selectedLoadout = selected;
      }
    }

    default:
  }
  /* eslint-enable */
  return data;
};

/**
 * Refreshes a player snapshot from a loaded Player instance. Used to "reload" things like equipment
 * since an item's stats could have changed since the snapshot was saved.
 */
export const toPlayerPatch = (loadout: PartialDeep<Player>): PlayerPatch => {
  const {
    equipment, style, spell, prayers, buffs, ...rest
  } = loadout;
  const patch: PlayerPatch = rest;

  if (equipment) {
    const resolved: Partial<PlayerEquipment> = {};
    for (const slot of keys(equipment)) {
      const stored = equipment[slot];
      if (stored === undefined) continue;

      let item: EquipmentPiece | null = null;
      if (stored !== null) {
        const current = availableEquipment.find((eq) => eq.id === stored.id)
          ?? (typeof stored.id === 'number' && stored.id < 0
            ? availableEquipment.find((eq) => eq.id === releasedFracturedItemIds[stored.id!])
              ?? availableEquipment.find((eq) => eq.name === stored.name && eq.slot === stored.slot)
            : undefined);
        if (!current) {
          console.warn(`[toPlayerPatch] No item found for item ID ${stored.id}`);
        } else {
          item = stored.itemVars ? { ...current, itemVars: stored.itemVars } : current;
        }
      }
      resolved[slot] = item;
    }
    patch.equipment = resolved;
  }

  if (style) patch.style = style as PlayerCombatStyle;
  if (spell === null) patch.spell = null;
  if (spell?.name) patch.spell = spellByName(spell.name);
  if (prayers) patch.prayers = prayers.filter((p): p is Prayer => p !== undefined);
  if (buffs) patch.buffs = buffs as Partial<PlayerBuffs>;

  return patch;
};

/**
 * Loads a MonsterDefinition from a Monster input. Used to "reload" a monster during shortlink/localstorage load
 * in case its stats have changed since the snapshot was saved.
 */
export const resolveMonsterDefinition = (monster: Monster): MonsterDefinition => {
  const { inputs, ...stored } = monster;
  if (stored.id === CUSTOM_MONSTER_ID) {
    return stored;
  }

  const migrated = releasedFracturedMonsterIds[stored.id];
  const candidates = availableMonsters.filter((m) => m.id === (migrated?.id ?? stored.id));
  if (candidates.length === 0) {
    throw new Error(`Failed to find monster by id '${stored.id}' from shortlink`);
  }
  return candidates.find((m) => m.version === (migrated?.version ?? stored.version)) ?? candidates[0];
};

export const hasNonDefaultDefenceReductions = (inputs: Partial<Monster['inputs']> | undefined): boolean => {
  const reductions = inputs?.defenceReductions ?? {};
  return keys(reductions).some((k) => reductions[k] !== undefined && reductions[k] !== INITIAL_MONSTER_INPUTS.defenceReductions[k]);
};
