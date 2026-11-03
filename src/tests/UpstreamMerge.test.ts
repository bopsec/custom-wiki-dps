import { describe, expect, test } from '@jest/globals';
import RootStore, { ImportableData } from '@/state/RootStore';
import { getTestMonsterById } from '@/tests/utils/TestUtils';

describe('fork state after upstream store migration', () => {
  test('old sessions retain the selected spec setup and released equipment', () => {
    const root = new RootStore();
    root.importData({
      serializationVersion: 12,
      selectedLoadout: 1,
      monster: { ...getTestMonsterById(16659), id: 16660 },
      loadouts: [
        { name: 'DPS' },
        { name: 'Spec', specSetup: true, equipment: { weapon: { id: -40002 } } },
      ],
    } as unknown as ImportableData);
    expect(root.loadouts.currentLoadout.specSetup).toBe(true);
    expect(root.loadouts.currentLoadout.equipment.weapon?.id).toBe(34725);
    expect(root.monster.id).toBe(16659);
    expect(root.monster.definition.version).toBe('Grounded');

    const restored = new RootStore();
    restored.importData(root.snapshot);
    expect(restored.loadouts.currentLoadout.snapshot).toEqual(root.loadouts.currentLoadout.snapshot);
    expect(restored.loadouts.create({ cloneFrom: restored.loadouts.selectedUuid })?.specSetup).toBe(true);
    expect(restored.calc.request.loadouts.get(restored.loadouts.selectedUuid)?.specSetup).toBe(true);
  });
});
