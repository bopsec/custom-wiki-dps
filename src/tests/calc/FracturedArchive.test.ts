import { describe, expect, test } from '@jest/globals';
import { BORK_PHASES, MONSTER_PHASES_BY_ID } from '@/lib/constants';
import { ammoApplicability, AmmoApplicability, availableEquipment } from '@/lib/Equipment';
import { getMonsters, INITIAL_MONSTER_INPUTS } from '@/lib/Monsters';
import applyDefenceReductions, { getDefenceFloor } from '@/lib/scaling/DefenceReduction';
import applyMonsterPhases from '@/lib/scaling/Phases';
import PlayerVsNPCCalc from '@/lib/PlayerVsNPCCalc';
import { getSpecSwapAttackOutcomes } from '@/lib/SpecWeaponSwap';
import { parseLoadoutsFromImportedData } from '@/state';
import { ImportableData } from '@/types/State';
import { getCombatStylesForCategory } from '@/utils';
import {
  calculatePlayerVsNpc, findEquipment, findSpell, getTestMonsterById, getTestPlayer,
} from '@/tests/utils/TestUtils';

const target = getTestMonsterById(415);

describe('Fractured Archive upstream implementation', () => {
  test('Zorya special gates three follow-up hits on the first hit', () => {
    const weapon = findEquipment("Zorya's tome");
    const player = getTestPlayer(target, { equipment: { weapon } });
    const normal = new PlayerVsNPCCalc(player, target);
    const spec = new PlayerVsNPCCalc(player, target, { usingSpecialAttack: true });
    const accuracy = spec.getHitChance();
    const distribution = spec.getDistribution();
    const singleHitDamage = distribution.dists[0].expectedHit();
    const outcomes = getSpecSwapAttackOutcomes(spec);

    expect(normal.getDistribution().dists).toHaveLength(1);
    expect(distribution.dists).toHaveLength(4);
    expect(distribution.followUpsRequireFirstHit).toBe(true);
    expect(spec.getMax()).toBe(distribution.dists[0].getMax() * 4);
    expect(spec.getExpectedDamage()).toBeCloseTo(singleHitDamage * (1 + 3 * accuracy));
    expect(distribution.singleHitsplat.expectedHit()).toBeCloseTo(spec.getExpectedDamage());
    expect(spec.getExpectedAttackSpeed()).toBeCloseTo(spec.getAttackSpeed() + 6 * accuracy);
    expect(outcomes.filter((outcome) => outcome.successfulHits === 0)
      .reduce((sum, outcome) => sum + outcome.probability, 0)).toBeCloseTo(1 - accuracy);
    expect(outcomes.filter((outcome) => outcome.successfulHits === 4)
      .reduce((sum, outcome) => sum + outcome.probability, 0)).toBeCloseTo(accuracy ** 4);
    expect(outcomes.reduce((sum, outcome) => sum + outcome.probability, 0)).toBeCloseTo(1);
  });

  test('released equipment replaces provisional IDs in saved loadouts', () => {
    expect(availableEquipment.some((item) => item.id <= -40001 && item.id >= -40007)).toBe(false);
    const oldLoadout = (id: number, name: string) => ({ equipment: { weapon: { id, name, slot: 'weapon' } } });
    const imported = parseLoadoutsFromImportedData({
      serializationVersion: 0,
      selectedLoadout: 0,
      monster: target,
      loadouts: [oldLoadout(-40003, 'The Obligator'), oldLoadout(-40002, "Zorya's Tome")],
    } as ImportableData);
    expect(imported[0].equipment?.weapon?.id).toBe(34715);
    expect(imported[1].equipment?.weapon?.id).toBe(34725);
  });

  test('NPCs use Wiki records without Frac duplicates', () => {
    const monsters = getMonsters();
    expect(monsters.some((monster) => monster.name.startsWith('Frac '))).toBe(false);
    expect(monsters.filter((monster) => monster.id === 16659).map((monster) => monster.version))
      .toEqual(['Flying', 'Grounded']);
    expect(monsters.find((monster) => monster.id === 16673)?.version).toBe('Phase 1');
    expect(monsters.find((monster) => monster.id === 16667)?.weakness)
      .toEqual({ element: 'air', severity: 80 });
  });

  test('Bork Smork HP phases adjust armour and magic resistance', () => {
    expect(MONSTER_PHASES_BY_ID[16640]).toEqual(BORK_PHASES);
    const bork = getTestMonsterById(16640);
    BORK_PHASES.slice(0, 4).forEach((phase, index) => {
      const scaled = applyMonsterPhases({ ...bork, inputs: { ...bork.inputs, phase } });
      expect(scaled.defensive.flat_armour).toBe(8 + index * 2);
      expect(scaled.defensive.magic_resistance).toBe(index * 2);
    });
    expect(applyMonsterPhases({ ...bork, inputs: { ...bork.inputs, phase: 'Stunned' } }).defensive)
      .toEqual(bork.defensive);
  });

  test('Wiki Defence floors apply to the released bosses', () => {
    const cappedIds = [16659, 16640, 16652, 16667, 16684, 16673, 16677];
    const uncappedIds = [16665, 16641, 16643, 16645, 16647];
    const monsters = getMonsters();
    for (const id of [...cappedIds, ...uncappedIds]) {
      const base = monsters.find((monster) => monster.id === id);
      expect(base).toBeDefined();
      const monster = {
        ...base!,
        inputs: {
          ...INITIAL_MONSTER_INPUTS,
          defenceReductions: { ...INITIAL_MONSTER_INPUTS.defenceReductions, bgs: 10000 },
        },
      };
      const floor = cappedIds.includes(id) ? Math.trunc(base!.skills.def * 0.6) : 0;
      expect(getDefenceFloor(monster)).toBe(floor);
      expect(applyDefenceReductions(monster).skills.def).toBe(floor);
    }
  });

  test('Obligator has both Wiki Thrust styles and the faster Smash style', () => {
    const weapon = findEquipment('Obligator');
    expect(getCombatStylesForCategory(weapon.category).map((style) => style.name))
      .toEqual(['Thrust-Acc', 'Thrust-Agg', 'Smash', 'Spell']);
    const monster = { ...target, size: 3 };
    const thrust = getTestPlayer(monster, {
      equipment: { weapon },
      style: { name: 'Thrust-Agg', type: 'crush', stance: 'Aggressive' },
    });
    const smash = getTestPlayer(monster, {
      equipment: { weapon },
      style: { name: 'Smash', type: 'crush', stance: 'Aggressive' },
    });
    expect(thrust.attackSpeed).toBe(5);
    expect(smash.attackSpeed).toBe(3);
    expect(calculatePlayerVsNpc(monster, thrust).maxHit)
      .toBeGreaterThan(calculatePlayerVsNpc(monster, smash).maxHit);
  });

  test('Wiki spell fragments and Ascension ammunition are available', () => {
    const spell = findSpell('Fire Surge');
    const base = getTestPlayer(target, {
      spell,
      style: { name: 'Cast', type: 'magic', stance: 'Manual Cast' },
    });
    const upgraded = getTestPlayer(target, {
      spell,
      style: { name: 'Cast', type: 'magic', stance: 'Manual Cast' },
      buffs: { fragmentOfFire: true },
    });
    expect(calculatePlayerVsNpc(target, upgraded).maxHit)
      .toBeGreaterThan(calculatePlayerVsNpc(target, base).maxHit);

    const crossbow = findEquipment('Ascension crossbows');
    expect(ammoApplicability(crossbow.id, findEquipment('Ascension bolts').id))
      .toBe(AmmoApplicability.INCLUDED);
    expect(ammoApplicability(crossbow.id, findEquipment('Diamond ascension bolts').id))
      .toBe(AmmoApplicability.INCLUDED);
    expect(ammoApplicability(crossbow.id, findEquipment('Dragon bolts').id))
      .toBe(AmmoApplicability.INVALID);
  });
});
