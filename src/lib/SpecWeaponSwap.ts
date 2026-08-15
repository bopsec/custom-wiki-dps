import { max } from 'd3-array';
import PlayerVsNPCCalc from '@/lib/PlayerVsNPCCalc';
import { scaleMonster } from '@/lib/MonsterScaling';
import { SECONDS_PER_TICK } from '@/lib/constants';
import type { Monster } from '@/types/Monster';
import type { Player } from '@/types/Player';

export interface SpecSwapOptions {
  startingEnergy: number;
  maxSpecs: number;
}

export interface SpecSwapAttack {
  loadoutIndex: number;
  loadoutName: string;
  weaponName: string;
  specCost: number;
  expectedDamage: number;
  maxHit: number;
  accuracy: number;
}

export interface SpecSwapResult {
  attacks: SpecSwapAttack[];
  remainingEnergy: number;
  expectedSpecDamage: number;
  expectedSeconds: number;
  finisherName: string;
  finisherSeconds: number;
}

interface AttackCandidate extends SpecSwapAttack {
  speed: number;
  histogram: Map<number, number>;
}

interface FinishCandidate {
  name: string;
  speed: number;
  histogram: Map<number, number>;
  memory: Float64Array;
}

const MAX_HP = 400;
const MAX_RESULTS = 10;
const MAX_STATE_COUNT = 50_000;

const histogramFromCalc = (calc: PlayerVsNPCCalc): Map<number, number> => {
  const histogram = new Map<number, number>();
  calc.getDistribution().singleHitsplat.hits.forEach((hit) => {
    const damage = hit.getSum();
    histogram.set(damage, (histogram.get(damage) || 0) + hit.probability);
  });
  return histogram;
};

const buildFinisherMemory = (finishers: FinishCandidate[], cappedHp: number): Float64Array => {
  const memory = new Float64Array(cappedHp + 1);

  for (let hp = 1; hp <= cappedHp; hp++) {
    let bestTicks = Infinity;

    for (const finisher of finishers) {
      const missChance = finisher.histogram.get(0) || 0;
      if (missChance >= 1) {
        continue;
      }

      let weightedRemainingTicks = 0;
      for (const [damage, probability] of finisher.histogram.entries()) {
        if (damage <= 0 || probability === 0) {
          continue;
        }
        weightedRemainingTicks += probability * memory[Math.max(hp - damage, 0)];
      }

      bestTicks = Math.min(bestTicks, (weightedRemainingTicks + finisher.speed) / (1 - missChance));
    }

    memory[hp] = bestTicks;
  }

  return memory;
};

const getBestFinisher = (finishers: FinishCandidate[], hp: number) => {
  let best = finishers[0];
  let bestTicks = best?.memory[hp] ?? Infinity;
  for (const finisher of finishers) {
    const ticks = finisher.memory[hp];
    if (ticks < bestTicks) {
      best = finisher;
      bestTicks = ticks;
    }
  }
  return { best, bestTicks };
};

const applyAttack = (
  hpDist: Map<number, number>,
  attack: AttackCandidate,
): Map<number, number> => {
  const next = new Map<number, number>();

  for (const [hp, hpProbability] of hpDist.entries()) {
    for (const [damage, damageProbability] of attack.histogram.entries()) {
      const remainingHp = Math.max(hp - damage, 0);
      next.set(remainingHp, (next.get(remainingHp) || 0) + (hpProbability * damageProbability));
    }
  }

  return next;
};

const expectedRemainingTicks = (
  hpDist: Map<number, number>,
  finisherMemory: Float64Array,
) => {
  let expected = 0;
  for (const [hp, probability] of hpDist.entries()) {
    expected += probability * finisherMemory[hp];
  }
  return expected;
};

export const computeSpecWeaponSwaps = (
  loadouts: Player[],
  monster: Monster,
  options: SpecSwapOptions,
): SpecSwapResult[] => {
  const scaledMonster = scaleMonster(JSON.parse(JSON.stringify(monster)) as Monster);
  const cappedHp = Math.min(scaledMonster.skills.hp, MAX_HP);

  const specCandidates = loadouts.flatMap((loadout, i): AttackCandidate[] => {
    if (!loadout.specSetup) {
      return [];
    }

    const baseCalc = new PlayerVsNPCCalc(loadout, scaledMonster, {
      detailedOutput: false,
      disableMonsterScaling: true,
    });
    const specCalc = baseCalc.getSpecCalc();
    const specCost = specCalc?.getSpecCost();
    if (!specCalc || !specCost) {
      return [];
    }

    return [{
      loadoutIndex: i,
      loadoutName: loadout.name || `Loadout ${i + 1}`,
      weaponName: loadout.equipment.weapon?.name || loadout.name || `Loadout ${i + 1}`,
      specCost,
      expectedDamage: specCalc.getExpectedDamage(),
      maxHit: specCalc.getMax(),
      accuracy: specCalc.getDisplayHitChance(),
      speed: specCalc.getExpectedAttackSpeed(),
      histogram: histogramFromCalc(specCalc),
    }];
  });

  const finishers = loadouts.flatMap((loadout, i): FinishCandidate[] => {
    if (loadout.specSetup) {
      return [];
    }

    const calc = new PlayerVsNPCCalc(loadout, scaledMonster, {
      detailedOutput: false,
      disableMonsterScaling: true,
    });
    const histogram = histogramFromCalc(calc);
    if (!(max(histogram.keys()) || 0)) {
      return [];
    }

    return [{
      name: loadout.name || `Loadout ${i + 1}`,
      speed: calc.getExpectedAttackSpeed(),
      histogram,
      memory: new Float64Array(cappedHp + 1),
    }];
  });

  if (specCandidates.length === 0 || finishers.length === 0) {
    return [];
  }

  const finisherMemory = buildFinisherMemory(finishers, cappedHp);
  for (const finisher of finishers) {
    finisher.memory = buildFinisherMemory([finisher], cappedHp);
  }

  const results: SpecSwapResult[] = [];
  const dfs = (
    remainingEnergy: number,
    remainingSpecs: number,
    hpDist: Map<number, number>,
    attacks: SpecSwapAttack[],
    specTicks: number,
  ) => {
    const finishTicks = expectedRemainingTicks(hpDist, finisherMemory);
    const expectedHp = [...hpDist.entries()].reduce((sum, [hp, probability]) => sum + (hp * probability), 0);
    const representativeHp = Math.max(0, Math.min(cappedHp, Math.round(expectedHp)));
    const { best: finisher, bestTicks } = getBestFinisher(finishers, representativeHp);
    results.push({
      attacks,
      remainingEnergy,
      expectedSpecDamage: cappedHp - expectedHp,
      expectedSeconds: (specTicks + finishTicks) * SECONDS_PER_TICK,
      finisherName: finisher?.name || 'N/A',
      finisherSeconds: bestTicks * SECONDS_PER_TICK,
    });

    if (remainingSpecs <= 0 || results.length > MAX_STATE_COUNT) {
      return;
    }

    for (const candidate of specCandidates) {
      if (candidate.specCost > remainingEnergy) {
        continue;
      }
      dfs(
        remainingEnergy - candidate.specCost,
        remainingSpecs - 1,
        applyAttack(hpDist, candidate),
        [...attacks, candidate],
        specTicks + candidate.speed,
      );
    }
  };

  dfs(
    Math.max(0, Math.min(100, options.startingEnergy)),
    Math.max(0, options.maxSpecs),
    new Map([[cappedHp, 1]]),
    [],
    0,
  );

  return results
    .filter((result) => result.attacks.length > 0)
    .sort((a, b) => a.expectedSeconds - b.expectedSeconds)
    .slice(0, MAX_RESULTS);
};
