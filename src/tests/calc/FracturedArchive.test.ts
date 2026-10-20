import { describe, expect, test } from '@jest/globals';
import { Prayer } from '@/enums/Prayer';
import { ammoApplicability, AmmoApplicability } from '@/lib/Equipment';
import { getMonsters } from '@/lib/Monsters';
import PlayerVsNPCCalc from '@/lib/PlayerVsNPCCalc';
import { getSpecSwapAttackOutcomes } from '@/lib/SpecWeaponSwap';
import {
  calculateNpcVsPlayer, calculatePlayerVsNpc, findEquipment, findSpell,
  getTestMonsterById, getTestPlayer,
} from '@/tests/utils/TestUtils';

const target = getTestMonsterById(415);

describe('Fractured Archive rewards', () => {
  test('Fractured Archive NPCs include the supplied combat stats and ranged defence', () => {
    const ids = [
      16659, 16660, 16662, 16640, 16641, 16643, 16644, 16649, 16650,
      16651, 16652, 16653, 16665, 16666, 16667, 16670, 16684, 16687,
      16688, 16674, 16675, 16677, 16676, 16678, 16679, 16680, 16681,
    ];
    const rangedDefence: Record<number, [number, number, number]> = {
      16659: [75, 120, 50],
      16660: [75, 120, 50],
      16640: [80, 50, 5],
      16641: [80, 150, 80],
      16665: [100, 80, 80],
      16684: [125, 230, 155],
      16674: [50, 135, 50],
      16675: [100, 110, 80],
      16677: [250, 250, 250],
    };
    const weaknesses: Record<number, { element: string, severity: number }> = {
      16659: { element: 'fire', severity: 80 },
      16660: { element: 'fire', severity: 80 },
      16666: { element: 'fire', severity: 80 },
      16640: { element: 'earth', severity: 40 },
      16641: { element: 'earth', severity: 85 },
      16684: { element: 'water', severity: 85 },
    };
    const monsters = getMonsters();
    for (const id of ids) {
      const monster = monsters.find((m) => m.id === id);
      const [light, standard, heavy] = rangedDefence[id] || [50, 50, 50];
      expect(monster).toBeDefined();
      expect(monster?.name.startsWith('Frac ')).toBe(true);
      expect(monster?.defensive.light).toBe(light);
      expect(monster?.defensive.standard).toBe(standard);
      expect(monster?.defensive.heavy).toBe(heavy);
      expect(monster?.weakness).toEqual(weaknesses[id] || null);
    }

    expect(monsters.find((m) => m.id === 16659)?.skills.hp).toBe(550);
    expect(monsters.find((m) => m.id === 16660)?.skills.hp).toBe(1100);
    expect(monsters.find((m) => m.id === 16688)?.defensive.crush).toBe(-20);
    expect(monsters.find((m) => m.id === 16675)?.skills.hp).toBe(5250);
    expect(monsters.find((m) => m.id === 16677)?.skills.hp).toBe(5250);
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
    const weapon = findEquipment('The Obligator');
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
    const weapon = findEquipment('The Obligator');
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
    const weapon = findEquipment("Zorya's Tome");
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
    const weapon = findEquipment("Zorya's Tome");
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
