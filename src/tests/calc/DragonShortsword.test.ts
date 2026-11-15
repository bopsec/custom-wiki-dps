import { expect, test } from '@jest/globals';
import { availableEquipment } from '@/lib/Equipment';
import PlayerVsNPCCalc from '@/lib/PlayerVsNPCCalc';
import { getTestMonster, getTestPlayer } from '@/tests/utils/TestUtils';

test.each([21009, 28029])('renamed Dragon shortsword %i retains its special attack', (id) => {
  const monster = getTestMonster('Abyssal demon', 'Standard', {
    defensive: { stab: 0, slash: 200 },
  });
  const weapon = availableEquipment.find((item) => item.id === id)!;
  const player = getTestPlayer(monster, { equipment: { weapon } });
  const normal = new PlayerVsNPCCalc(player, monster);
  const spec = normal.getSpecCalc();
  expect(weapon.name).toMatch(/^Dragon shortsword/);
  expect(spec).not.toBeNull();
  expect(spec!.getSpecCost()).toBe(40);
  expect(spec!.getMaxAttackRoll()).toBe(Math.trunc(normal.getMaxAttackRoll() * 1.25));
  expect(spec!.getMax()).toBe(Math.trunc(normal.getMax() * 1.25));

  const slashSpec = new PlayerVsNPCCalc({
    ...player, style: { name: 'Slash', type: 'slash', stance: 'Aggressive' },
  }, monster, { usingSpecialAttack: true });
  expect(slashSpec.getNPCDefenceRoll()).toBe(spec!.getNPCDefenceRoll());
});
