import { describe, expect, test } from '@jest/globals';
import PlayerVsNPCCalc from '@/lib/PlayerVsNPCCalc';
import applyDefenceReductions from '@/lib/scaling/DefenceReduction';
import {
  applySpecDefenceReduction,
  getSpecSwapAttackOutcomes,
} from '@/lib/SpecWeaponSwap';
import {
  findEquipment,
  getTestMonster,
  getTestPlayer,
} from '@/tests/utils/TestUtils';

const getTonalzticsSetup = () => {
  const monster = getTestMonster('Abyssal demon', 'Standard', {
    skills: {
      def: 200,
      magic: 80,
      hp: 500,
    },
  });
  const player = getTestPlayer(monster, {
    equipment: {
      weapon: findEquipment('Tonalztics of Ralos', 'Charged'),
    },
    skills: {
      ranged: 99,
    },
  });
  return { monster, player };
};

describe('Tonalztics of Ralos spec weapon swaps', () => {
  test('tracks zero, one, or two successful hits from two independent rolls', () => {
    const { monster, player } = getTonalzticsSetup();
    const calc = new PlayerVsNPCCalc(player, monster, { usingSpecialAttack: true });
    const outcomes = getSpecSwapAttackOutcomes(calc);
    const probabilityBySuccessfulHits = new Map<number, number>();
    outcomes.forEach((outcome) => {
      probabilityBySuccessfulHits.set(
        outcome.successfulHits,
        (probabilityBySuccessfulHits.get(outcome.successfulHits) || 0) + outcome.probability,
      );
    });

    const firstAccuracy = calc.getHitChance();
    const onceReducedMonster = {
      ...monster,
      inputs: {
        ...monster.inputs,
        defenceReductions: {
          ...monster.inputs.defenceReductions,
          tonalztic: monster.inputs.defenceReductions.tonalztic + 1,
        },
      },
    };
    const accuracyAfterFirstHit = new PlayerVsNPCCalc(
      player,
      onceReducedMonster,
      { usingSpecialAttack: true },
    ).getHitChance();

    expect(calc.getSpecCost()).toBe(50);
    expect(probabilityBySuccessfulHits.get(0)).toBeCloseTo((1 - firstAccuracy) ** 2);
    expect(probabilityBySuccessfulHits.get(1)).toBeCloseTo(
      firstAccuracy * (1 - accuracyAfterFirstHit) + (1 - firstAccuracy) * firstAccuracy,
    );
    expect(probabilityBySuccessfulHits.get(2)).toBeCloseTo(firstAccuracy * accuracyAfterFirstHit);
  });

  test('applies one eighth of magic level for each successful hit', () => {
    const { monster } = getTonalzticsSetup();
    const reductionState = applySpecDefenceReduction(
      monster.inputs.defenceReductions,
      'Tonalztics of Ralos',
      0,
      2,
      [],
    );
    const reducedMonster = applyDefenceReductions({
      ...monster,
      inputs: {
        ...monster.inputs,
        defenceReductions: reductionState.reductions,
      },
    });

    expect(reductionState.reductions.tonalztic).toBe(2);
    expect(reducedMonster.skills.def).toBe(
      monster.skills.def - 2 * Math.trunc(monster.skills.magic / 8),
    );
  });
});
