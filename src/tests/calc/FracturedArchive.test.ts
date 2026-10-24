import { describe, expect, test } from '@jest/globals';
import { Prayer } from '@/enums/Prayer';
import { ammoApplicability, AmmoApplicability, availableEquipment } from '@/lib/Equipment';
import { getMonsters, INITIAL_MONSTER_INPUTS } from '@/lib/Monsters';
import PlayerVsNPCCalc from '@/lib/PlayerVsNPCCalc';
import { getSpecSwapAttackOutcomes } from '@/lib/SpecWeaponSwap';
import applyDefenceReductions, { getDefenceFloor } from '@/lib/scaling/DefenceReduction';
import { parseLoadoutsFromImportedData } from '@/state';
import { ImportableData } from '@/types/State';
import {
  calculateNpcVsPlayer, calculatePlayerVsNpc, findEquipment, findSpell,
  getTestMonsterById, getTestPlayer,
} from '@/tests/utils/TestUtils';

const target = getTestMonsterById(415);

describe('Fractured Archive rewards', () => {
  test('released equipment replaces temporary IDs in saved loadouts', () => {
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

  test('Fractured Archive Defence reductions stop at each NPC\'s floor', () => {
    const cappedIds = [16659, 16640, 16652, 16667, 16684, 16673, 16675, 16677];
    const uncappedIds = [16665, 16641, 16643, 16645, 16647, 16676];
    const monsters = getMonsters();

    for (const id of [...cappedIds, ...uncappedIds]) {
      const base = monsters.find((m) => m.id === id);
      expect(base).toBeDefined();
      const monster = {
        ...base!,
        inputs: {
          ...INITIAL_MONSTER_INPUTS,
          defenceReductions: { ...INITIAL_MONSTER_INPUTS.defenceReductions, bgs: 10000 },
        },
      };
      const floor = cappedIds.includes(id) ? Math.trunc(base!.skills.def * 3 / 5) : 0;
      expect(getDefenceFloor(monster)).toBe(floor);
      expect(applyDefenceReductions(monster).skills.def).toBe(floor);
    }
  });

  test('upstream NPC records replace provisional stats while missing phases retain fallbacks', () => {
    const monsters = getMonsters();
    const guardian = monsters.filter((m) => m.id === 16659);
    expect(guardian.map((m) => m.version)).toEqual(['Flying', 'Grounded']);
    expect(guardian.map((m) => m.weakness?.severity)).toEqual([80, 40]);
    expect(monsters.find((m) => m.id === 16673)?.name).toBe('Ocellus');
    expect(monsters.find((m) => m.id === 16673)?.version).toBe('Phase 1');
    expect(monsters.find((m) => m.id === 16667)?.weakness).toEqual({ element: 'air', severity: 80 });
    expect(monsters.find((m) => m.id === 16666)?.weakness).toEqual({ element: 'fire', severity: 60 });
    expect(monsters.find((m) => m.id === 16675)?.name).toBe('Frac Ocellus');
    expect(monsters.find((m) => m.id === 16676)?.name).toBe('Frac The Blade');
    expect(monsters.some((m) => m.id === 16674)).toBe(false);
  });

  test('unknown NPC attack speed does not produce non-finite damage taken', () => {
    const monster = getTestMonsterById(16651);
    expect(monster.speed).toBe(0);
    expect(calculateNpcVsPlayer(monster, getTestPlayer(monster)).npcDps).toBe(0);
  });

  test('Zeal improves both melee accuracy and damage over Piety', () => {
    const weapon = findEquipment('Abyssal whip');
    const player = (prayer: Prayer) => getTestPlayer(target, {
      equipment: { weapon },
      prayers: [prayer],
      style: { name: 'Flick', type: 'slash', stance: 'Accurate' },
    });
    const piety = calculatePlayerVsNpc(target, player(Prayer.PIETY));
    const zeal = calculatePlayerVsNpc(target, player(Prayer.ZEAL));
    expect(zeal.maxAttackRoll).toBeGreaterThan(piety.maxAttackRoll);
    expect(zeal.maxHit).toBeGreaterThan(piety.maxHit);
  });

  test('the Obligator rolls more damage against crush weakness and scales with size', () => {
    const weapon = findEquipment('Obligator');
    const neutral = getTestMonsterById(415, {
      size: 1,
      defensive: { stab: 50, slash: 50, crush: 50 },
    });
    const player = getTestPlayer(neutral, {
      equipment: { weapon },
      style: { name: 'Thrust', type: 'crush', stance: 'Aggressive' },
    });
    const base = calculatePlayerVsNpc(neutral, player);
    const weak = getTestMonsterById(415, {
      size: 3,
      defensive: { stab: 50, slash: 50, crush: 0 },
    });
    const boosted = calculatePlayerVsNpc(weak, player);
    expect(boosted.maxHit).toBeGreaterThan(base.maxHit);
    expect(boosted.dist.getExpectedDamage()).toBeGreaterThan(base.dist.getExpectedDamage());
    const smash = getTestPlayer(weak, {
      equipment: { weapon },
      style: { name: 'Smash', type: 'crush', stance: 'Aggressive' },
    });
    const unmodifiedMax = calculatePlayerVsNpc(weak, smash).maxHit;
    const small = calculatePlayerVsNpc({ ...weak, size: 1 }, player);
    const medium = calculatePlayerVsNpc({ ...weak, size: 2 }, player);
    expect(small.maxHit).toBe(unmodifiedMax);
    expect(medium.maxHit).toBe(Math.trunc(unmodifiedMax * 1.2));
    expect(boosted.maxHit).toBe(Math.trunc(unmodifiedMax * 1.4));
    for (const result of [small, medium, boosted]) {
      expect(result.dist.asHistogram().at(-1)?.name).toBe(result.maxHit.toString());
    }
    expect(smash.attackSpeed).toBe(3);
    expect(player.attackSpeed).toBe(5);
  });

  test('size-adjusted Obligator rolls retain every damage value through the final max', () => {
    const monster = { ...getTestMonsterById(415), size: 3 };
    const weapon = findEquipment('Obligator');
    const setup = (name: 'Smash' | 'Thrust', strengthBonus: number) => getTestPlayer(monster, {
      equipment: { weapon },
      bonuses: { str: strengthBonus },
      style: { name, type: 'crush', stance: 'Aggressive' },
    });
    const baseMax = calculatePlayerVsNpc(monster, setup('Smash', 288)).maxHit;
    const thrust = calculatePlayerVsNpc(monster, setup('Thrust', 288));
    expect(baseMax).toBe(61);
    expect(thrust.maxHit).toBe(85);
    expect(thrust.dist.asHistogram()[76].value).toBeGreaterThan(0);

    const lowerBase = calculatePlayerVsNpc(monster, setup('Smash', 191)).maxHit;
    const lowerThrust = calculatePlayerVsNpc(monster, setup('Thrust', 191));
    expect(lowerBase).toBe(44);
    expect(lowerThrust.maxHit).toBe(61);
    const histogram = lowerThrust.dist.asHistogram();
    for (let damage = 1; damage <= 61; damage++) {
      expect(histogram[damage].value).toBeGreaterThan(0);
    }
  });

  test('Zorya base hit scales with Magic level before its damage bonuses', () => {
    const weapon = findEquipment("Zorya's tome");
    for (const [magic, normalMax, specMax] of [
      [80, 18, 112],
      [90, 23, 144],
      [99, 26, 164],
    ]) {
      const player = getTestPlayer(target, {
        equipment: { weapon },
        skills: { magic },
      });
      expect(calculatePlayerVsNpc(target, player).maxHit).toBe(normalMax);
      expect(calculatePlayerVsNpc(target, player, { usingSpecialAttack: true }).maxHit)
        .toBe(specMax);
    }
  });

  test('Zorya special groups four independent rolls gated by its first hit', () => {
    const weapon = findEquipment("Zorya's tome");
    const player = getTestPlayer(target, { equipment: { weapon } });
    const normal = new PlayerVsNPCCalc(player, target);
    const spec = new PlayerVsNPCCalc(player, target, { usingSpecialAttack: true });
    const accuracy = spec.getHitChance();
    const singleHitDamage = spec.getDistribution().dists[0].expectedHit();
    const outcomes = getSpecSwapAttackOutcomes(spec);

    expect(normal.getAttackSpeed()).toBe(3);
    expect(normal.getSpecCalc()).not.toBeNull();
    expect(normal.getDistribution().dists).toHaveLength(1);
    expect(spec.getDistribution().dists).toHaveLength(4);
    expect(spec.getDistribution().followUpsRequireFirstHit).toBe(true);
    expect(spec.getMax()).toBe(spec.getDistribution().dists[0].getMax() * 4);
    expect(spec.getExpectedDamage()).toBeCloseTo(singleHitDamage * (1 + 3 * accuracy));
    expect(spec.getDistribution().singleHitsplat.expectedHit()).toBeCloseTo(spec.getExpectedDamage());
    expect(spec.getExpectedAttackSpeed()).toBeCloseTo(3 + 6 * accuracy);
    expect(outcomes.filter((outcome) => outcome.successfulHits === 0)
      .reduce((sum, outcome) => sum + outcome.probability, 0)).toBeCloseTo(1 - accuracy);
    expect(outcomes.filter((outcome) => outcome.successfulHits === 4)
      .reduce((sum, outcome) => sum + outcome.probability, 0)).toBeCloseTo(accuracy ** 4);
    expect(outcomes.reduce((sum, outcome) => sum + outcome.probability, 0)).toBeCloseTo(1);
  });

  test('Ascension bolts are required and add their ranged strength', () => {
    const weapon = findEquipment('Ascension crossbows');
    const bolts = findEquipment('Ascension bolts');
    expect(ammoApplicability(weapon.id, bolts.id)).toBe(AmmoApplicability.INCLUDED);
    expect(ammoApplicability(weapon.id, findEquipment('Dragon bolts').id)).toBe(AmmoApplicability.INVALID);
    const player = getTestPlayer(target, {
      equipment: { weapon, ammo: bolts },
      style: { name: 'Rapid', type: 'ranged', stance: 'Rapid' },
    });
    expect(player.bonuses.ranged_str).toBe(53);
    expect(player.attackSpeed).toBe(2);
  });

  test('elemental fragments add two to the matching spell and Rondache reduces incoming hits', () => {
    const spell = findSpell('Fire Surge');
    const base = getTestPlayer(target, {
      spell,
      style: { name: 'Cast', type: 'magic', stance: 'Manual Cast' },
    });
    const upgraded = getTestPlayer(target, {
      spell,
      style: { name: 'Cast', type: 'magic', stance: 'Manual Cast' },
      buffs: { elementalFragments: { fire: true } },
    });
    expect(calculatePlayerVsNpc(target, upgraded).maxHit)
      .toBeGreaterThan(calculatePlayerVsNpc(target, base).maxHit);

    const shield = getTestPlayer(target, { equipment: { shield: findEquipment('Rondache') } });
    expect(calculateNpcVsPlayer(target, shield).npcDps)
      .toBeLessThan(calculateNpcVsPlayer(target, getTestPlayer(target)).npcDps);
  });
});
