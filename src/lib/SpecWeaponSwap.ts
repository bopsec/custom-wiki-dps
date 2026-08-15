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

export interface SpecSwapPoint {
  hitpoints: number;
  loadoutIndex: number;
  loadoutName: string;
  expectedTicks: number;
  expectedSeconds: number;
  weaponOnlyExpectedTicks: number;
  weaponOnlyExpectedSeconds: number;
}

export interface SpecSwapRange {
  fromHp: number;
  toHp: number;
  loadoutIndex: number;
  loadoutName: string;
}

export interface SpecSwapMode {
  points: SpecSwapPoint[];
  ranges: SpecSwapRange[];
  loadouts: {
    loadoutIndex: number;
    loadoutName: string;
  }[];
}

export interface SpecSwapModes {
  continuous: SpecSwapMode;
  discontinuous: SpecSwapMode;
}

export interface SpecSwapResult {
  attacks: SpecSwapAttack[];
  remainingEnergy: number;
  expectedSpecDamage: number;
  expectedSeconds: number;
  finisherName: string;
  finisherSeconds: number;
}

export interface SpecSwapOutcomeOverride {
  attackIndex: number;
  mode: 'average' | 'damage' | 'hit' | 'miss';
  damage?: number;
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

const MAX_RESULTS = 10;
const MAX_STATE_COUNT = 50_000;
const DEFENCE_REDUCTION_SPEC_WEAPONS = [
  'Elder maul',
  'Dragon warhammer',
  'Arclight',
  'Emberlight',
  'Bandos godsword',
  'Tonalztics of ralos',
  'Accursed sceptre',
  'Accursed sceptre (a)',
  'Eye of ayak',
];

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

const hasDefenceReductionSpec = (attacks: SpecSwapAttack[]): boolean => (
  attacks.some((attack) => DEFENCE_REDUCTION_SPEC_WEAPONS.includes(attack.weaponName))
);

const histogramFromCalc = (calc: PlayerVsNPCCalc): Map<number, number> => {
  const histogram = new Map<number, number>();
  calc.getDistribution().singleHitsplat.hits.forEach((hit) => {
    const damage = hit.getSum();
    histogram.set(damage, (histogram.get(damage) || 0) + hit.probability);
  });
  return histogram;
};

const getRemainingTicks = (
  remainingHp: number,
  continuous: boolean,
  speed: number,
  memory: Float64Array,
): number => {
  if (remainingHp > 0) {
    return memory[remainingHp];
  }
  if (continuous) {
    return 0;
  }
  return -speed;
};

const buildFinisherMemory = (
  finishers: FinishCandidate[],
  maxHp: number,
  continuous: boolean,
): Float64Array => {
  const memory = new Float64Array(maxHp + 1);

  for (let hp = 1; hp <= maxHp; hp++) {
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
        weightedRemainingTicks += probability * getRemainingTicks(hp - damage, continuous, finisher.speed, memory);
      }

      bestTicks = Math.min(bestTicks, (weightedRemainingTicks + finisher.speed) / (1 - missChance));
    }

    memory[hp] = bestTicks;
  }

  return memory;
};

const buildRanges = (points: SpecSwapPoint[]): SpecSwapRange[] => {
  const ranges: SpecSwapRange[] = [];
  for (const point of points) {
    const prev = ranges[ranges.length - 1];
    if (prev && prev.loadoutIndex === point.loadoutIndex && prev.toHp + 1 === point.hitpoints) {
      prev.toHp = point.hitpoints;
    } else {
      ranges.push({
        fromHp: point.hitpoints,
        toHp: point.hitpoints,
        loadoutIndex: point.loadoutIndex,
        loadoutName: point.loadoutName,
      });
    }
  }
  return ranges;
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
  getFinisherMemory: (reductions: DefenceReductions, continuous: boolean) => Float64Array,
  continuous: boolean,
) => {
  let expected = 0;
  for (const state of states) {
    expected += state.probability * getFinisherMemory(state.reductions, continuous)[state.hp];
  }
  return expected;
};

const getDisplayFinisher = (
  states: SpecState[],
  getSingleFinisherMemory: (loadoutIndex: number, reductions: DefenceReductions, continuous: boolean) => Float64Array,
  baseFinishers: FinishCandidate[],
  continuous: boolean,
) => {
  let best = baseFinishers[0];
  let bestTicks = Infinity;

  for (const finisher of baseFinishers) {
    let expectedTicks = 0;
    for (const state of states) {
      expectedTicks += (
        state.probability * getSingleFinisherMemory(finisher.loadoutIndex, state.reductions, continuous)[state.hp]
      );
    }
    if (expectedTicks < bestTicks) {
      best = finisher;
      bestTicks = expectedTicks;
    }
  }

  return { best, bestTicks };
};

const getBestNextFinisherAtHp = (
  hp: number,
  states: SpecState[],
  getFinisherCandidate: (loadoutIndex: number, hp: number, reductions: DefenceReductions) => FinishCandidate | null,
  getFinisherMemory: (reductions: DefenceReductions, continuous: boolean) => Float64Array,
  getSingleFinisherMemory: (loadoutIndex: number, reductions: DefenceReductions, continuous: boolean) => Float64Array,
  baseFinishers: FinishCandidate[],
  continuous: boolean,
) => {
  let best = baseFinishers[0];
  let bestTicks = Infinity;
  let bestWeaponOnlyTicks = Infinity;

  for (const finisher of baseFinishers) {
    let expectedTicks = 0;
    let weaponOnlyExpectedTicks = 0;

    for (const state of states) {
      const stateFinisher = getFinisherCandidate(finisher.loadoutIndex, hp, state.reductions);
      if (!stateFinisher) {
        expectedTicks = Infinity;
        weaponOnlyExpectedTicks = Infinity;
        break;
      }

      const missChance = stateFinisher.histogram.get(0) || 0;
      if (missChance >= 1) {
        expectedTicks = Infinity;
        weaponOnlyExpectedTicks = Infinity;
        break;
      }

      let weightedRemainingTicks = 0;
      let weightedWeaponOnlyRemainingTicks = 0;
      const optimalMemory = getFinisherMemory(state.reductions, continuous);
      const weaponOnlyMemory = getSingleFinisherMemory(finisher.loadoutIndex, state.reductions, continuous);

      for (const [damage, probability] of stateFinisher.histogram.entries()) {
        if (damage <= 0 || probability === 0) {
          continue;
        }

        const remainingHp = hp - damage;
        weightedRemainingTicks += probability * getRemainingTicks(
          remainingHp,
          continuous,
          stateFinisher.speed,
          optimalMemory,
        );
        weightedWeaponOnlyRemainingTicks += probability * getRemainingTicks(
          remainingHp,
          continuous,
          stateFinisher.speed,
          weaponOnlyMemory,
        );
      }

      expectedTicks += state.probability * (
        (weightedRemainingTicks + stateFinisher.speed) / (1 - missChance)
      );
      weaponOnlyExpectedTicks += state.probability * (
        (weightedWeaponOnlyRemainingTicks + stateFinisher.speed) / (1 - missChance)
      );
    }

    if (expectedTicks < bestTicks) {
      best = finisher;
      bestTicks = expectedTicks;
      bestWeaponOnlyTicks = weaponOnlyExpectedTicks;
    }
  }

  return { best, bestTicks, bestWeaponOnlyTicks };
};

const getPostSpecSwapMode = (
  states: SpecState[],
  baseFinishers: FinishCandidate[],
  getFinisherCandidate: (loadoutIndex: number, hp: number, reductions: DefenceReductions) => FinishCandidate | null,
  getFinisherMemory: (reductions: DefenceReductions, continuous: boolean) => Float64Array,
  getSingleFinisherMemory: (loadoutIndex: number, reductions: DefenceReductions, continuous: boolean) => Float64Array,
  continuous: boolean,
  maxChartHp: number,
): SpecSwapMode => {
  const highestAliveHp = Math.min(maxChartHp, Math.max(...states.map((state) => state.hp)));
  const points: SpecSwapPoint[] = [];

  for (let hp = 1; hp <= highestAliveHp; hp++) {
    const eligibleStates = states.filter((state) => state.hp >= hp);
    const hpProbability = eligibleStates.reduce((sum, state) => sum + state.probability, 0);
    if (hpProbability === 0) {
      continue;
    }

    const weightedStates = eligibleStates.map((state) => ({
      ...state,
      probability: state.probability / hpProbability,
    }));

    const { best, bestTicks, bestWeaponOnlyTicks } = getBestNextFinisherAtHp(
      hp,
      weightedStates,
      getFinisherCandidate,
      getFinisherMemory,
      getSingleFinisherMemory,
      baseFinishers,
      continuous,
    );

    points.push({
      hitpoints: hp,
      loadoutIndex: best.loadoutIndex,
      loadoutName: best.name,
      expectedTicks: bestTicks,
      expectedSeconds: bestTicks * SECONDS_PER_TICK,
      weaponOnlyExpectedTicks: bestWeaponOnlyTicks,
      weaponOnlyExpectedSeconds: bestWeaponOnlyTicks * SECONDS_PER_TICK,
    });
  }

  return {
    points,
    ranges: buildRanges(points),
    loadouts: baseFinishers.map((finisher) => ({
      loadoutIndex: finisher.loadoutIndex,
      loadoutName: finisher.name,
    })),
  };
};

const trimStates = (states: SpecState[]): SpecState[] => {
  if (states.length <= MAX_STATE_COUNT) {
    return states;
  }

  return states
    .sort((a, b) => b.probability - a.probability)
    .slice(0, MAX_STATE_COUNT);
};

const getAveragePositiveDamage = (histogram: Map<number, number>): number => {
  let hitProbability = 0;
  let weightedDamage = 0;
  for (const [damage, probability] of histogram.entries()) {
    if (damage <= 0) {
      continue;
    }
    hitProbability += probability;
    weightedDamage += damage * probability;
  }

  return hitProbability > 0 ? Math.round(weightedDamage / hitProbability) : 0;
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
  maxHp: number,
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
    memory: new Float64Array(maxHp + 1),
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

const makeInitialState = (maxHp: number, reductions: DefenceReductions): SpecState[] => [{
  hp: maxHp,
  reductions: cloneReductions(reductions),
  probability: 1,
}];

const emptySwapModes = (): SpecSwapModes => ({
  continuous: {
    points: [],
    ranges: [],
    loadouts: [],
  },
  discontinuous: {
    points: [],
    ranges: [],
    loadouts: [],
  },
});

const getOutcomeOverride = (
  overrides: SpecSwapOutcomeOverride[],
  attackIndex: number,
): SpecSwapOutcomeOverride => (
  overrides.find((override) => override.attackIndex === attackIndex) || { attackIndex, mode: 'average' }
);

const applyOutcomeAttack = (
  states: SpecState[],
  attack: SpecSwapAttack,
  attackIndex: number,
  overrides: SpecSwapOutcomeOverride[],
  getAttackCandidate: (loadoutIndex: number, hp: number, reductions: DefenceReductions) => AttackCandidate | null,
): SpecState[] => {
  const override = getOutcomeOverride(overrides, attackIndex);
  if (override.mode === 'average') {
    return applyAttack(states, attack, getAttackCandidate);
  }

  const next = new Map<string, SpecState>();
  for (const state of states) {
    const attackState = getAttackCandidate(attack.loadoutIndex, state.hp, state.reductions);
    if (!attackState) {
      continue;
    }

    const damage = (() => {
      if (override.mode === 'miss') {
        return 0;
      }
      if (override.mode === 'hit') {
        return getAveragePositiveDamage(attackState.histogram);
      }
      return Math.max(0, Math.min(attackState.maxHit, Math.round(override.damage || 0)));
    })();
    const remainingHp = Math.max(state.hp - damage, 0);
    const reductions = applySpecDefenceReduction(state.reductions, attack.weaponName, damage);
    const key = stateKey(remainingHp, reductions);
    const existing = next.get(key);
    if (existing) {
      existing.probability += state.probability;
    } else {
      next.set(key, {
        hp: remainingHp,
        reductions,
        probability: state.probability,
      });
    }
  }

  return [...next.values()];
};

export const computeSpecWeaponSwapGraph = (
  loadouts: Player[],
  monster: Monster,
  attacks: SpecSwapAttack[],
  overrides: SpecSwapOutcomeOverride[],
): SpecSwapModes => {
  const baseMonster = buildBaseMonster(monster);
  const maxHp = baseMonster.skills.hp;
  const initialReductions = cloneReductions(monster.inputs.defenceReductions);
  const initialMonster = withDefenceReductions(baseMonster, maxHp, initialReductions);
  const normalLoadouts = loadouts
    .map((loadout, loadoutIndex) => ({ loadout, loadoutIndex }))
    .filter(({ loadout }) => !loadout.specSetup);

  const baseFinishers = normalLoadouts.flatMap(({ loadout, loadoutIndex }): FinishCandidate[] => {
    const finisher = buildFinishCandidate(loadout, loadoutIndex, initialMonster, maxHp);
    return finisher ? [finisher] : [];
  });

  if (attacks.length === 0 || baseFinishers.length === 0) {
    return emptySwapModes();
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
  const finisherCandidateCache = new Map<string, FinishCandidate | null>();
  const getFinisherCandidate = (
    loadoutIndex: number,
    hp: number,
    reductions: DefenceReductions,
  ): FinishCandidate | null => {
    const key = `${loadoutIndex}|${hp}|${reductionKey(reductions)}`;
    if (!finisherCandidateCache.has(key)) {
      const stateMonster = withDefenceReductions(baseMonster, hp, reductions);
      finisherCandidateCache.set(
        key,
        buildFinishCandidate(loadouts[loadoutIndex], loadoutIndex, stateMonster, maxHp),
      );
    }
    return finisherCandidateCache.get(key) || null;
  };
  const getFinishers = (reductions: DefenceReductions): FinishCandidate[] => {
    const stateMonster = withDefenceReductions(baseMonster, maxHp, reductions);
    return normalLoadouts.flatMap(({ loadout, loadoutIndex }): FinishCandidate[] => {
      const finisher = buildFinishCandidate(loadout, loadoutIndex, stateMonster, maxHp);
      return finisher ? [finisher] : [];
    });
  };
  const getFinisherMemory = (reductions: DefenceReductions, continuous: boolean): Float64Array => {
    const key = `${continuous ? 'c' : 'd'}|${reductionKey(reductions)}`;
    if (!finisherMemoryCache.has(key)) {
      finisherMemoryCache.set(key, buildFinisherMemory(getFinishers(reductions), maxHp, continuous));
    }
    return finisherMemoryCache.get(key)!;
  };
  const getSingleFinisherMemory = (
    loadoutIndex: number,
    reductions: DefenceReductions,
    continuous: boolean,
  ): Float64Array => {
    const key = `${continuous ? 'c' : 'd'}|${loadoutIndex}|${reductionKey(reductions)}`;
    if (!singleFinisherMemoryCache.has(key)) {
      const stateMonster = withDefenceReductions(baseMonster, maxHp, reductions);
      const finisher = buildFinishCandidate(loadouts[loadoutIndex], loadoutIndex, stateMonster, maxHp);
      singleFinisherMemoryCache.set(
        key,
        finisher ? buildFinisherMemory([finisher], maxHp, continuous) : new Float64Array(maxHp + 1),
      );
    }
    return singleFinisherMemoryCache.get(key)!;
  };

  const states = attacks.reduce(
    (currentStates, attack, attackIndex) => trimStates(applyOutcomeAttack(
      currentStates,
      attack,
      attackIndex,
      overrides,
      getAttackCandidate,
    )),
    makeInitialState(maxHp, initialReductions),
  );
  const expectedHp = getExpectedHp(states);
  const maxChartHp = hasDefenceReductionSpec(attacks) ? Math.max(1, Math.ceil(expectedHp)) : maxHp;

  return {
    continuous: getPostSpecSwapMode(
      states,
      baseFinishers,
      getFinisherCandidate,
      getFinisherMemory,
      getSingleFinisherMemory,
      true,
      maxChartHp,
    ),
    discontinuous: getPostSpecSwapMode(
      states,
      baseFinishers,
      getFinisherCandidate,
      getFinisherMemory,
      getSingleFinisherMemory,
      false,
      maxChartHp,
    ),
  };
};

export const computeSpecWeaponSwaps = (
  loadouts: Player[],
  monster: Monster,
  options: SpecSwapOptions,
): SpecSwapResult[] => {
  const baseMonster = buildBaseMonster(monster);
  const maxHp = baseMonster.skills.hp;
  const initialReductions = cloneReductions(monster.inputs.defenceReductions);
  const initialMonster = withDefenceReductions(baseMonster, maxHp, initialReductions);

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
    const finisher = buildFinishCandidate(loadout, loadoutIndex, initialMonster, maxHp);
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
    const stateMonster = withDefenceReductions(baseMonster, maxHp, reductions);
    return normalLoadouts.flatMap(({ loadout, loadoutIndex }): FinishCandidate[] => {
      const finisher = buildFinishCandidate(loadout, loadoutIndex, stateMonster, maxHp);
      return finisher ? [finisher] : [];
    });
  };
  const getFinisherMemory = (reductions: DefenceReductions, continuous: boolean): Float64Array => {
    const key = `${continuous ? 'c' : 'd'}|${reductionKey(reductions)}`;
    if (!finisherMemoryCache.has(key)) {
      finisherMemoryCache.set(key, buildFinisherMemory(getFinishers(reductions), maxHp, continuous));
    }
    return finisherMemoryCache.get(key)!;
  };
  const getSingleFinisherMemory = (
    loadoutIndex: number,
    reductions: DefenceReductions,
    continuous: boolean,
  ): Float64Array => {
    const key = `${continuous ? 'c' : 'd'}|${loadoutIndex}|${reductionKey(reductions)}`;
    if (!singleFinisherMemoryCache.has(key)) {
      const stateMonster = withDefenceReductions(baseMonster, maxHp, reductions);
      const finisher = buildFinishCandidate(loadouts[loadoutIndex], loadoutIndex, stateMonster, maxHp);
      singleFinisherMemoryCache.set(
        key,
        finisher ? buildFinisherMemory([finisher], maxHp, continuous) : new Float64Array(maxHp + 1),
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
    const expectedHp = getExpectedHp(states);
    const finishTicks = expectedRemainingTicks(states, getFinisherMemory, true);
    const { best: finisher, bestTicks } = getDisplayFinisher(
      states,
      getSingleFinisherMemory,
      baseFinishers,
      true,
    );
    results.push({
      attacks,
      remainingEnergy,
      expectedSpecDamage: maxHp - expectedHp,
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
    makeInitialState(maxHp, initialReductions),
    [],
    0,
  );

  return results
    .filter((result) => result.attacks.length > 0)
    .sort((a, b) => a.expectedSeconds - b.expectedSeconds)
    .slice(0, MAX_RESULTS);
};
