import { describe, expect, test } from '@jest/globals';
import { Prayer } from '@/enums/Prayer';
import { ammoApplicability, AmmoApplicability } from '@/lib/Equipment';
import {
  calculateNpcVsPlayer, calculatePlayerVsNpc, findEquipment, findSpell,
  getTestMonsterById, getTestPlayer,
} from '@/tests/utils/TestUtils';

const target = getTestMonsterById(415);

describe('Fractured Archive rewards', () => {
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

  test('a 61 base max cannot create a 76 damage hit from the size bonus', () => {
    const monster = { ...getTestMonsterById(415), size: 3 };
    const weapon = findEquipment('The Obligator');
    const setup = (name: 'Smash' | 'Thrust') => getTestPlayer(monster, {
      equipment: { weapon },
      bonuses: { str: 288 },
      style: { name, type: 'crush', stance: 'Aggressive' },
    });
    const baseMax = calculatePlayerVsNpc(monster, setup('Smash')).maxHit;
    const thrust = calculatePlayerVsNpc(monster, setup('Thrust'));
    expect(baseMax).toBe(61);
    expect(thrust.maxHit).toBe(85);
    expect(thrust.dist.asHistogram()[76].value).toBe(0);
  });

  test('Zorya has a 3 tick normal attack and faster empowered follow-ups', () => {
    const weapon = findEquipment("Zorya's Tome");
    const normal = getTestPlayer(target, { equipment: { weapon } });
    const empowered = getTestPlayer(target, {
      equipment: { weapon },
      buffs: { zoryaEmpowered: true },
    });
    expect(normal.attackSpeed).toBe(3);
    expect(empowered.attackSpeed).toBe(2);
    expect(calculatePlayerVsNpc(target, empowered).dps).toBeGreaterThan(calculatePlayerVsNpc(target, normal).dps);
    expect(calculatePlayerVsNpc(target, normal, { usingSpecialAttack: true }).maxHit)
      .toBeGreaterThan(calculatePlayerVsNpc(target, normal).maxHit);
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
