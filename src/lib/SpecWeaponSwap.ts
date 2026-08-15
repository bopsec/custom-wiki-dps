import { max } from 'd3-array';
import PlayerVsNPCCalc from '@/lib/PlayerVsNPCCalc';
import { scaleMonster, scaleMonsterHpOnly } from '@/lib/MonsterScaling';
import applyDefenceReductions from '@/lib/scaling/DefenceReduction';
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
  loadoutIndex: number;
  name: string;
  speed: number;
  histogram: Map<number, number>;
  memory: Float64Array;
}

type DefenceReductions = Monster['inputs']['defenceReductions'];

interface SpecState {
  hp: number;
  reductions: DefenceReductions;
  probability: number;
}

const MAX_HP = 400;
const MAX_RESULTS = 10;
const MAX_STATE_COUNT = 50_000;

const EMPTY_REDUCTIONS: DefenceReductions = {
  vulnerability: false,
  accursed: false,
  elderMaul: 0,
  dwh: 0,
  arclight: 0,
  emberlight: 0,
  bgs: 0,
  tonalztic: 0,
  seercull: 0,
  ayak: 0,
};

const reductionKey = (reductions: DefenceReductions): string => [
  reductions.vulnerability ? 1 : 0,
  reductions.accursed ? 1 : 0,
  reductions.elderMaul,
  reductions.dwh,
  reductions.arclight,
  reductions.emberlight,
  reductions.bgs,
  reductions.tonalztic,
  reductions.seercull,
  reductions.ayak,
].join(':');

const stateKey = (hp: number, reductions: DefenceReductions): string => `${hp}|${reductionKey(reductions)}`;

const cloneReductions = (reductions: DefenceReductions): DefenceReductions => ({ ...reductions });

const withDefenceReductions = (
  baseMonster: Monster,
  hp: number,
  reductions: DefenceReductions,
): Monster => applyDefenceReductions(scaleMonsterHpOnly({
  ...baseMonster,
  inputs: {
    ...baseMonster.inputs,
    monsterCurrentHp: hp,
    defenceReductions: reductions,
  },
}));

const applySpecDefenceReduction = (
  reductions: DefenceReductions,
  weaponName: string,
  damage: number,
): DefenceReductions => {
  if (damage <= 0) {
    return reductions;
  }

  const next = cloneReductions(reductions);

  switch (weaponName) {
    case 'Elder maul':
      next.elderMaul += 1;
      break;
    case 'Dragon warhammer':
      next.dwh += 1;
      break;
    case 'Arclight':
      next.arclight += 1;
      break;
    case 'Emberlight':
      next.emberlight += 1;
      break;
    case 'Bandos godsword':
      next.bgs += damage;
      break;
    case 'Tonalztics of ralos':
      next.tonalztic += 1;
      break;
    case 'Accursed sceptre':
    case 'Accursed sceptre (a)':
      next.accursed = true;
      break;
    case 'Eye of ayak':
      next.ayak += damage;
      break;
    default:
      break;
  }

  return next;
};

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

const applyAttack = (
  states: SpecState[],
  attack: SpecSwapAttack,
  getAttackCandidate: (loadoutIndex: number, hp: number, reductions: DefenceReductions) => AttackCandidate | null,
): SpecState[] => {
  const next = new Map<string, SpecState>();

  for (const state of states) {
    const attackState = getAttackCandidate(attack.loadoutIndex, state.hp, state.reductions);
    if (!attackState) {
      continue;
    }

    for (const [damage, damageProbability] of attackState.histogram.entries()) {
      const remainingHp = Math.max(state.hp - damage, 0);
      const reductions = applySpecDefenceReduction(state.reductions, attack.weaponName, damage);
      const key = stateKey(remainingHp, reductions);
      const probability = state.probability * damageProbability;
      const existing = next.get(key);
      if (existing) {
        existing.probability += probability;
      } else {
        next.set(key, {
          hp: remainingHp,
          reductions,
          probability,
        });
      }
    }
  }

  return [...next.values()];
};

const expectedRemainingTicks = (
  states: SpecState[],
  getFinisherMemory: (reductions: DefenceReductions) => Float64Array,
) => {
  let expected = 0;
  for (const state of states) {
    expected += state.probability * getFinisherMemory(state.reductions)[state.hp];
  }
  return expected;
};

const getDisplayFinisher = (
  states: SpecState[],
  getSingleFinisherMemory: (loadoutIndex: number, reductions: DefenceReductions) => Float64Array,
  baseFinishers: FinishCandidate[],
) => {
  let best = baseFinishers[0];
  let bestTicks = Infinity;

  for (const finisher of baseFinishers) {
    let expectedTicks = 0;
    for (const state of states) {
      expectedTicks += state.probability * getSingleFinisherMemory(finisher.loadoutIndex, state.reductions)[state.hp];
    }
    if (expectedTicks < bestTicks) {
      best = finisher;
      bestTicks = expectedTicks;
    }
  }

  return { best, bestTicks };
};

const trimStates = (states: SpecState[]): SpecState[] => {
  if (states.length <= MAX_STATE_COUNT) {
    return states;
  }

  return states
    .sort((a, b) => b.probability - a.probability)
    .slice(0, MAX_STATE_COUNT);
};

const buildAttackCandidate = (
  loadout: Player,
  loadoutIndex: number,
  monster: Monster,
): AttackCandidate | null => {
  const baseCalc = new PlayerVsNPCCalc(loadout, monster, {
    detailedOutput: false,
    disableMonsterScaling: true,
  });
  const specCalc = baseCalc.getSpecCalc();
  const specCost = specCalc?.getSpecCost();
  if (!specCalc || !specCost) {
    return null;
  }

  return {
    loadoutIndex,
    loadoutName: loadout.name || `Loadout ${loadoutIndex + 1}`,
    weaponName: loadout.equipment.weapon?.name || loadout.name || `Loadout ${loadoutIndex + 1}`,
    specCost,
    expectedDamage: specCalc.getExpectedDamage(),
    maxHit: specCalc.getMax(),
    accuracy: specCalc.getDisplayHitChance(),
    speed: specCalc.getExpectedAttackSpeed(),
    histogram: histogramFromCalc(specCalc),
  };
};

const buildFinishCandidate = (
  loadout: Player,
  loadoutIndex: number,
  monster: Monster,
  cappedHp: number,
): FinishCandidate | null => {
  const calc = new PlayerVsNPCCalc(loadout, monster, {
    detailedOutput: false,
    disableMonsterScaling: true,
  });
  const histogram = histogramFromCalc(calc);
  if (!(max(histogram.keys()) || 0)) {
    return null;
  }

  return {
    loadoutIndex,
    name: loadout.name || `Loadout ${loadoutIndex + 1}`,
    speed: calc.getExpectedAttackSpeed(),
    histogram,
    memory: new Float64Array(cappedHp + 1),
  };
};

const getExpectedHp = (states: SpecState[]): number => (
  states.reduce((sum, state) => sum + (state.hp * state.probability), 0)
);

const buildBaseMonster = (monster: Monster): Monster => scaleMonster({
  ...(JSON.parse(JSON.stringify(monster)) as Monster),
  inputs: {
    ...monster.inputs,
    defenceReductions: EMPTY_REDUCTIONS,
  },
});

const makeInitialState = (cappedHp: number, reductions: DefenceReductions): SpecState[] => [{
  hp: cappedHp,
  reductions: cloneReductions(reductions),
  probability: 1,
}];

export const computeSpecWeaponSwaps = (
  loadouts: Player[],
  monster: Monster,
  options: SpecSwapOptions,
): SpecSwapResult[] => {
  const baseMonster = buildBaseMonster(monster);
  const cappedHp = Math.min(baseMonster.skills.hp, MAX_HP);
  const initialReductions = cloneReductions(monster.inputs.defenceReductions);
  const initialMonster = withDefenceReductions(baseMonster, cappedHp, initialReductions);

  const specLoadouts = loadouts
    .map((loadout, loadoutIndex) => ({ loadout, loadoutIndex }))
    .filter(({ loadout }) => loadout.specSetup);
  const normalLoadouts = loadouts
    .map((loadout, loadoutIndex) => ({ loadout, loadoutIndex }))
    .filter(({ loadout }) => !loadout.specSetup);

  const specCandidates = specLoadouts.flatMap(({ loadout, loadoutIndex }): AttackCandidate[] => {
    const candidate = buildAttackCandidate(loadout, loadoutIndex, initialMonster);
    return candidate ? [candidate] : [];
  });

  const baseFinishers = normalLoadouts.flatMap(({ loadout, loadoutIndex }): FinishCandidate[] => {
    const finisher = buildFinishCandidate(loadout, loadoutIndex, initialMonster, cappedHp);
    return finisher ? [finisher] : [];
  });

  if (specCandidates.length === 0 || baseFinishers.length === 0) {
    return [];
  }

  const attackCache = new Map<string, AttackCandidate | null>();
  const getAttackCandidate = (
    loadoutIndex: number,
    hp: number,
    reductions: DefenceReductions,
  ): AttackCandidate | null => {
    const key = `${loadoutIndex}|${hp}|${reductionKey(reductions)}`;
    if (!attackCache.has(key)) {
      const loadout = loadouts[loadoutIndex];
      const stateMonster = withDefenceReductions(baseMonster, hp, reductions);
      attackCache.set(key, buildAttackCandidate(loadout, loadoutIndex, stateMonster));
    }
    return attackCache.get(key) || null;
  };

  const finisherMemoryCache = new Map<string, Float64Array>();
  const singleFinisherMemoryCache = new Map<string, Float64Array>();
  const getFinishers = (reductions: DefenceReductions): FinishCandidate[] => {
    const stateMonster = withDefenceReductions(baseMonster, cappedHp, reductions);
    return normalLoadouts.flatMap(({ loadout, loadoutIndex }): FinishCandidate[] => {
      const finisher = buildFinishCandidate(loadout, loadoutIndex, stateMonster, cappedHp);
      return finisher ? [finisher] : [];
    });
  };
  const getFinisherMemory = (reductions: DefenceReductions): Float64Array => {
    const key = reductionKey(reductions);
    if (!finisherMemoryCache.has(key)) {
      finisherMemoryCache.set(key, buildFinisherMemory(getFinishers(reductions), cappedHp));
    }
    return finisherMemoryCache.get(key)!;
  };
  const getSingleFinisherMemory = (
    loadoutIndex: number,
    reductions: DefenceReductions,
  ): Float64Array => {
    const key = `${loadoutIndex}|${reductionKey(reductions)}`;
    if (!singleFinisherMemoryCache.has(key)) {
      const stateMonster = withDefenceReductions(baseMonster, cappedHp, reductions);
      const finisher = buildFinishCandidate(loadouts[loadoutIndex], loadoutIndex, stateMonster, cappedHp);
      singleFinisherMemoryCache.set(
        key,
        finisher ? buildFinisherMemory([finisher], cappedHp) : new Float64Array(cappedHp + 1),
      );
    }
    return singleFinisherMemoryCache.get(key)!;
  };

  const results: SpecSwapResult[] = [];
  const dfs = (
    remainingEnergy: number,
    remainingSpecs: number,
    states: SpecState[],
    attacks: SpecSwapAttack[],
    specTicks: number,
  ) => {
    const finishTicks = expectedRemainingTicks(states, getFinisherMemory);
    const expectedHp = getExpectedHp(states);
    const { best: finisher, bestTicks } = getDisplayFinisher(states, getSingleFinisherMemory, baseFinishers);
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
      const nextStates = trimStates(applyAttack(states, candidate, getAttackCandidate));
      if (nextStates.length === 0) {
        continue;
      }
      dfs(
        remainingEnergy - candidate.specCost,
        remainingSpecs - 1,
        nextStates,
        [...attacks, candidate],
        specTicks + candidate.speed,
      );
    }
  };

  dfs(
    Math.max(0, Math.min(100, options.startingEnergy)),
    Math.max(0, options.maxSpecs),
    makeInitialState(cappedHp, initialReductions),
    [],
    0,
  );

  return results
    .filter((result) => result.attacks.length > 0)
    .sort((a, b) => a.expectedSeconds - b.expectedSeconds)
    .slice(0, MAX_RESULTS);
};
