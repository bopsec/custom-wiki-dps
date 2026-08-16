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
  adaptiveFollowUps?: SpecSwapAdaptiveRange[];
  adaptive?: boolean;
}

export interface SpecSwapAdaptiveRange {
  fromDamage: number;
  toDamage: number;
  loadoutName: string;
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
}

type DefenceReductions = Monster['inputs']['defenceReductions'];
type SpecReductionOrder = NonNullable<Monster['inputs']['specReductionOrder']>;

interface SpecState {
  hp: number;
  reductions: DefenceReductions;
  reductionOrder: SpecReductionOrder;
  probability: number;
}

const MAX_RESULTS = 10;
// State trimming is already an approximation. Keep it bounded so defence-reduction
// specs cannot retain an unbounded number of HP/reduction combinations.
const MAX_STATE_COUNT = 4_096;
const MAX_MEMORY_CACHE_ENTRIES = 64;
const MAX_CANDIDATE_CACHE_ENTRIES = 2_048;
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
const DAMAGE_REDUCTION_SPEC_WEAPONS = [
  'Bandos godsword',
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

const reductionOrderKey = (order: SpecReductionOrder): string => order
  .map(({ type, damage }) => `${type}:${damage || 0}`)
  .join(',');

const stateKey = (hp: number, reductions: DefenceReductions, order: SpecReductionOrder): string => (
  `${hp}|${reductionKey(reductions)}|${reductionOrderKey(order)}`
);

const cloneReductions = (reductions: DefenceReductions): DefenceReductions => ({ ...reductions });

const initialReductionOrder = (reductions: DefenceReductions): SpecReductionOrder => [
  ...Array.from({ length: reductions.elderMaul }, () => ({ type: 'elderMaul' as const })),
  ...(reductions.bgs > 0 ? [{ type: 'bgs' as const, damage: reductions.bgs }] : []),
];

const withDefenceReductions = (
  baseMonster: Monster,
  hp: number,
  reductions: DefenceReductions,
  reductionOrder: SpecReductionOrder = [],
): Monster => applyDefenceReductions(scaleMonsterHpOnly({
  ...baseMonster,
  inputs: {
    ...baseMonster.inputs,
    monsterCurrentHp: hp,
    defenceReductions: reductions,
    specReductionOrder: reductionOrder,
  },
}));

const applySpecDefenceReduction = (
  reductions: DefenceReductions,
  weaponName: string,
  damage: number,
  reductionOrder: SpecReductionOrder,
): { reductions: DefenceReductions, reductionOrder: SpecReductionOrder } => {
  if (damage <= 0) {
    return { reductions, reductionOrder };
  }

  const next = cloneReductions(reductions);
  const nextOrder = [...reductionOrder];

  switch (weaponName) {
    case 'Elder maul':
      next.elderMaul += 1;
      nextOrder.push({ type: 'elderMaul' });
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
      nextOrder.push({ type: 'bgs', damage });
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

  return { reductions: next, reductionOrder: nextOrder };
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

const getCachedMemory = (
  cache: Map<string, Float64Array>,
  key: string,
  build: () => Float64Array,
): Float64Array => {
  const existing = cache.get(key);
  if (existing) {
    // Refresh the entry so frequently used defence states remain cached.
    cache.delete(key);
    cache.set(key, existing);
    return existing;
  }

  const memory = build();
  cache.set(key, memory);
  while (cache.size > MAX_MEMORY_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (oldestKey === undefined) {
      break;
    }
    cache.delete(oldestKey);
  }
  return memory;
};

const setBoundedCache = <T>(cache: Map<string, T>, key: string, value: T) => {
  cache.set(key, value);
  while (cache.size > MAX_CANDIDATE_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (oldestKey === undefined) {
      break;
    }
    cache.delete(oldestKey);
  }
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
  getAttackCandidate: (
    loadoutIndex: number,
    hp: number,
    reductions: DefenceReductions,
    reductionOrder: SpecReductionOrder,
  ) => AttackCandidate | null,
  dealDamage = true,
): SpecState[] => {
  const next = new Map<string, SpecState>();

  for (const state of states) {
    const attackState = getAttackCandidate(
      attack.loadoutIndex,
      state.hp,
      state.reductions,
      state.reductionOrder,
    );
    if (!attackState) {
      continue;
    }

    for (const [rolledDamage, damageProbability] of attackState.histogram.entries()) {
      const damage = dealDamage ? rolledDamage : 0;
      const remainingHp = Math.max(state.hp - damage, 0);
      const reductionState = applySpecDefenceReduction(
        state.reductions,
        attack.weaponName,
        damage,
        state.reductionOrder,
      );
      const key = stateKey(remainingHp, reductionState.reductions, reductionState.reductionOrder);
      const probability = state.probability * damageProbability;
      const existing = next.get(key);
      if (existing) {
        existing.probability += probability;
      } else {
        next.set(key, {
          hp: remainingHp,
          reductions: reductionState.reductions,
          reductionOrder: reductionState.reductionOrder,
          probability,
        });
      }
    }
  }

  return [...next.values()];
};

const expectedRemainingTicks = (
  states: SpecState[],
  getFinisherMemory: (reductions: DefenceReductions, reductionOrder: SpecReductionOrder, continuous: boolean) => Float64Array,
  continuous: boolean,
) => {
  let expected = 0;
  for (const state of states) {
    expected += state.probability * getFinisherMemory(state.reductions, state.reductionOrder, continuous)[state.hp];
  }
  return expected;
};

const getDisplayFinisher = (
  states: SpecState[],
  getSingleFinisherMemory: (loadoutIndex: number, reductions: DefenceReductions, reductionOrder: SpecReductionOrder, continuous: boolean) => Float64Array,
  baseFinishers: FinishCandidate[],
  continuous: boolean,
) => {
  let best = baseFinishers[0];
  let bestTicks = Infinity;

  for (const finisher of baseFinishers) {
    let expectedTicks = 0;
    for (const state of states) {
      expectedTicks += (
        state.probability * getSingleFinisherMemory(finisher.loadoutIndex, state.reductions, state.reductionOrder, continuous)[state.hp]
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
  getFinisherCandidate: (loadoutIndex: number, hp: number, reductions: DefenceReductions, reductionOrder: SpecReductionOrder) => FinishCandidate | null,
  getFinisherMemory: (reductions: DefenceReductions, reductionOrder: SpecReductionOrder, continuous: boolean) => Float64Array,
  getSingleFinisherMemory: (loadoutIndex: number, reductions: DefenceReductions, reductionOrder: SpecReductionOrder, continuous: boolean) => Float64Array,
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
      const stateFinisher = getFinisherCandidate(finisher.loadoutIndex, hp, state.reductions, state.reductionOrder);
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
      const optimalMemory = getFinisherMemory(state.reductions, state.reductionOrder, continuous);
      const weaponOnlyMemory = getSingleFinisherMemory(finisher.loadoutIndex, state.reductions, state.reductionOrder, continuous);

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
  getFinisherCandidate: (loadoutIndex: number, hp: number, reductions: DefenceReductions, reductionOrder: SpecReductionOrder) => FinishCandidate | null,
  getFinisherMemory: (reductions: DefenceReductions, reductionOrder: SpecReductionOrder, continuous: boolean) => Float64Array,
  getSingleFinisherMemory: (loadoutIndex: number, reductions: DefenceReductions, reductionOrder: SpecReductionOrder, continuous: boolean) => Float64Array,
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

  const trimmed = states
    .sort((a, b) => b.probability - a.probability)
    .slice(0, MAX_STATE_COUNT);
  const probability = trimmed.reduce((sum, state) => sum + state.probability, 0);
  if (probability === 0) {
    return trimmed;
  }
  return trimmed.map((state) => ({
    ...state,
    probability: state.probability / probability,
  }));
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

const getExpectedDamage = (histogram: Map<number, number>): number => {
  let expectedDamage = 0;
  for (const [damage, probability] of histogram.entries()) {
    expectedDamage += damage * probability;
  }
  return Math.round(expectedDamage);
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
  };
};

const getExpectedHp = (states: SpecState[]): number => (
  states.reduce((sum, state) => sum + (state.hp * state.probability), 0)
);

const buildAdaptiveFollowUps = (
  firstAttack: SpecSwapAttack,
  remainingEnergy: number,
  specCandidates: AttackCandidate[],
  maxHp: number,
  initialReductions: DefenceReductions,
  getAttackCandidate: (
    loadoutIndex: number,
    hp: number,
    reductions: DefenceReductions,
    reductionOrder: SpecReductionOrder,
  ) => AttackCandidate | null,
  getFinisherMemory: (reductions: DefenceReductions, reductionOrder: SpecReductionOrder, continuous: boolean) => Float64Array,
): SpecSwapAdaptiveRange[] => {
  const firstReductionOrder = initialReductionOrder(initialReductions);
  const firstCandidate = getAttackCandidate(
    firstAttack.loadoutIndex,
    maxHp,
    initialReductions,
    firstReductionOrder,
  );
  if (!firstCandidate) {
    return [];
  }

  const followUps = specCandidates.filter((candidate) => candidate.specCost <= remainingEnergy);
  if (followUps.length === 0) {
    return [];
  }

  const ranges: SpecSwapAdaptiveRange[] = [];
  for (const damage of [...firstCandidate.histogram.keys()].sort((a, b) => a - b)) {
    const firstReductionState = applySpecDefenceReduction(
      initialReductions,
      firstAttack.weaponName,
      damage,
      firstReductionOrder,
    );
    const firstState: SpecState = {
      hp: Math.max(maxHp - damage, 0),
      reductions: firstReductionState.reductions,
      reductionOrder: firstReductionState.reductionOrder,
      probability: 1,
    };
    let best: AttackCandidate | null = null;
    let bestTicks = Infinity;

    for (const candidate of followUps) {
      const nextStates = applyAttack([firstState], candidate, getAttackCandidate);
      if (nextStates.length === 0) {
        continue;
      }
      const ticks = candidate.speed + expectedRemainingTicks(
        nextStates,
        getFinisherMemory,
        true,
      );
      if (ticks < bestTicks) {
        best = candidate;
        bestTicks = ticks;
      }
    }

    if (!best) {
      continue;
    }
    const previous = ranges[ranges.length - 1];
    if (previous && previous.loadoutName === best.loadoutName && previous.toDamage + 1 === damage) {
      previous.toDamage = damage;
    } else {
      ranges.push({
        fromDamage: damage,
        toDamage: damage,
        loadoutName: best.loadoutName,
      });
    }
  }

  return ranges;
};

const buildBaseMonster = (monster: Monster): Monster => scaleMonster({
  ...(JSON.parse(JSON.stringify(monster)) as Monster),
  inputs: {
    ...monster.inputs,
    defenceReductions: EMPTY_REDUCTIONS,
    specReductionOrder: undefined,
  },
});

const makeInitialState = (maxHp: number, reductions: DefenceReductions): SpecState[] => [{
  hp: maxHp,
  reductions: cloneReductions(reductions),
  reductionOrder: initialReductionOrder(reductions),
  probability: 1,
}];

const emptySwapMode = (): SpecSwapMode => ({
  points: [],
  ranges: [],
  loadouts: [],
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
  getAttackCandidate: (
    loadoutIndex: number,
    hp: number,
    reductions: DefenceReductions,
    reductionOrder: SpecReductionOrder,
  ) => AttackCandidate | null,
  dealDamage = true,
): SpecState[] => {
  const override = getOutcomeOverride(overrides, attackIndex);
  if (override.mode === 'average' && !DAMAGE_REDUCTION_SPEC_WEAPONS.includes(attack.weaponName)) {
    return applyAttack(states, attack, getAttackCandidate, dealDamage);
  }

  const next = new Map<string, SpecState>();
  for (const state of states) {
    const attackState = getAttackCandidate(
      attack.loadoutIndex,
      state.hp,
      state.reductions,
      state.reductionOrder,
    );
    if (!attackState) {
      continue;
    }

    const damage = (() => {
      if (!dealDamage) {
        return 0;
      }
      if (override.mode === 'miss') {
        return 0;
      }
      if (override.mode === 'hit') {
        return getAveragePositiveDamage(attackState.histogram);
      }
      if (override.mode === 'average') {
        return getExpectedDamage(attackState.histogram);
      }
      return Math.max(0, Math.min(attackState.maxHit, Math.round(override.damage || 0)));
    })();
    const remainingHp = Math.max(state.hp - damage, 0);
    const reductionState = applySpecDefenceReduction(
      state.reductions,
      attack.weaponName,
      damage,
      state.reductionOrder,
    );
    const key = stateKey(remainingHp, reductionState.reductions, reductionState.reductionOrder);
    const existing = next.get(key);
    if (existing) {
      existing.probability += state.probability;
    } else {
      next.set(key, {
        hp: remainingHp,
        reductions: reductionState.reductions,
        reductionOrder: reductionState.reductionOrder,
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
  graphContinuous: boolean,
): SpecSwapMode => {
  const baseMonster = buildBaseMonster(monster);
  const maxHp = baseMonster.skills.hp;
  const initialReductions = cloneReductions(monster.inputs.defenceReductions);
  const initialMonster = withDefenceReductions(
    baseMonster,
    maxHp,
    initialReductions,
    initialReductionOrder(initialReductions),
  );
  const normalLoadouts = loadouts
    .map((loadout, loadoutIndex) => ({ loadout, loadoutIndex }))
    .filter(({ loadout }) => !loadout.specSetup);

  const baseFinishers = normalLoadouts.flatMap(({ loadout, loadoutIndex }): FinishCandidate[] => {
    const finisher = buildFinishCandidate(loadout, loadoutIndex, initialMonster);
    return finisher ? [finisher] : [];
  });

  if (attacks.length === 0 || baseFinishers.length === 0) {
    return emptySwapMode();
  }

  const attackCache = new Map<string, AttackCandidate | null>();
  const getAttackCandidate = (
    loadoutIndex: number,
    hp: number,
    reductions: DefenceReductions,
    reductionOrder: SpecReductionOrder,
  ): AttackCandidate | null => {
    const key = `${loadoutIndex}|${hp}|${reductionKey(reductions)}|${reductionOrderKey(reductionOrder)}`;
    if (!attackCache.has(key)) {
      const loadout = loadouts[loadoutIndex];
      const stateMonster = withDefenceReductions(baseMonster, hp, reductions, reductionOrder);
      setBoundedCache(attackCache, key, buildAttackCandidate(loadout, loadoutIndex, stateMonster));
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
    reductionOrder: SpecReductionOrder,
  ): FinishCandidate | null => {
    const key = `${loadoutIndex}|${hp}|${reductionKey(reductions)}|${reductionOrderKey(reductionOrder)}`;
    if (!finisherCandidateCache.has(key)) {
      const stateMonster = withDefenceReductions(baseMonster, hp, reductions, reductionOrder);
      setBoundedCache(
        finisherCandidateCache,
        key,
        buildFinishCandidate(loadouts[loadoutIndex], loadoutIndex, stateMonster),
      );
    }
    return finisherCandidateCache.get(key) || null;
  };
  const getFinishers = (reductions: DefenceReductions, reductionOrder: SpecReductionOrder): FinishCandidate[] => {
    const stateMonster = withDefenceReductions(baseMonster, maxHp, reductions, reductionOrder);
    return normalLoadouts.flatMap(({ loadout, loadoutIndex }): FinishCandidate[] => {
      const finisher = buildFinishCandidate(loadout, loadoutIndex, stateMonster);
      return finisher ? [finisher] : [];
    });
  };
  const getFinisherMemory = (reductions: DefenceReductions, reductionOrder: SpecReductionOrder, continuous: boolean): Float64Array => {
    const key = `${continuous ? 'c' : 'd'}|${reductionKey(reductions)}|${reductionOrderKey(reductionOrder)}`;
    return getCachedMemory(
      finisherMemoryCache,
      key,
      () => buildFinisherMemory(getFinishers(reductions, reductionOrder), maxHp, continuous),
    );
  };
  const getSingleFinisherMemory = (
    loadoutIndex: number,
    reductions: DefenceReductions,
    reductionOrder: SpecReductionOrder,
    continuous: boolean,
  ): Float64Array => {
    const key = `${continuous ? 'c' : 'd'}|${loadoutIndex}|${reductionKey(reductions)}|${reductionOrderKey(reductionOrder)}`;
    return getCachedMemory(singleFinisherMemoryCache, key, () => {
      const stateMonster = withDefenceReductions(baseMonster, maxHp, reductions, reductionOrder);
      const finisher = buildFinishCandidate(loadouts[loadoutIndex], loadoutIndex, stateMonster);
      return finisher ? buildFinisherMemory([finisher], maxHp, continuous) : new Float64Array(maxHp + 1);
    });
  };

  const includesDefenceReductionSpec = hasDefenceReductionSpec(attacks);
  const states = includesDefenceReductionSpec
    ? attacks.reduce(
      (currentStates, attack, attackIndex) => trimStates(applyOutcomeAttack(
        currentStates,
        attack,
        attackIndex,
        overrides,
        getAttackCandidate,
        !includesDefenceReductionSpec || DEFENCE_REDUCTION_SPEC_WEAPONS.includes(attack.weaponName),
      )),
      makeInitialState(maxHp, initialReductions),
    )
    : makeInitialState(maxHp, initialReductions);
  const expectedHp = getExpectedHp(states);
  const maxChartHp = includesDefenceReductionSpec ? Math.max(1, Math.ceil(expectedHp)) : maxHp;

  return getPostSpecSwapMode(
    states,
    baseFinishers,
    getFinisherCandidate,
    getFinisherMemory,
    getSingleFinisherMemory,
    graphContinuous,
    maxChartHp,
  );
};

export const computeSpecWeaponSwaps = (
  loadouts: Player[],
  monster: Monster,
  options: SpecSwapOptions,
): SpecSwapResult[] => {
  const baseMonster = buildBaseMonster(monster);
  const maxHp = baseMonster.skills.hp;
  const initialReductions = cloneReductions(monster.inputs.defenceReductions);
  const initialMonster = withDefenceReductions(
    baseMonster,
    maxHp,
    initialReductions,
    initialReductionOrder(initialReductions),
  );

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
    const finisher = buildFinishCandidate(loadout, loadoutIndex, initialMonster);
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
    reductionOrder: SpecReductionOrder,
  ): AttackCandidate | null => {
    const key = `${loadoutIndex}|${hp}|${reductionKey(reductions)}|${reductionOrderKey(reductionOrder)}`;
    if (!attackCache.has(key)) {
      const loadout = loadouts[loadoutIndex];
      const stateMonster = withDefenceReductions(baseMonster, hp, reductions, reductionOrder);
      setBoundedCache(attackCache, key, buildAttackCandidate(loadout, loadoutIndex, stateMonster));
    }
    return attackCache.get(key) || null;
  };

  const finisherMemoryCache = new Map<string, Float64Array>();
  const singleFinisherMemoryCache = new Map<string, Float64Array>();
  const getFinishers = (reductions: DefenceReductions, reductionOrder: SpecReductionOrder): FinishCandidate[] => {
    const stateMonster = withDefenceReductions(baseMonster, maxHp, reductions, reductionOrder);
    return normalLoadouts.flatMap(({ loadout, loadoutIndex }): FinishCandidate[] => {
      const finisher = buildFinishCandidate(loadout, loadoutIndex, stateMonster);
      return finisher ? [finisher] : [];
    });
  };
  const getFinisherMemory = (reductions: DefenceReductions, reductionOrder: SpecReductionOrder, continuous: boolean): Float64Array => {
    const key = `${continuous ? 'c' : 'd'}|${reductionKey(reductions)}|${reductionOrderKey(reductionOrder)}`;
    return getCachedMemory(
      finisherMemoryCache,
      key,
      () => buildFinisherMemory(getFinishers(reductions, reductionOrder), maxHp, continuous),
    );
  };
  const getSingleFinisherMemory = (
    loadoutIndex: number,
    reductions: DefenceReductions,
    reductionOrder: SpecReductionOrder,
    continuous: boolean,
  ): Float64Array => {
    const key = `${continuous ? 'c' : 'd'}|${loadoutIndex}|${reductionKey(reductions)}|${reductionOrderKey(reductionOrder)}`;
    return getCachedMemory(singleFinisherMemoryCache, key, () => {
      const stateMonster = withDefenceReductions(baseMonster, maxHp, reductions, reductionOrder);
      const finisher = buildFinishCandidate(loadouts[loadoutIndex], loadoutIndex, stateMonster);
      return finisher ? buildFinisherMemory([finisher], maxHp, continuous) : new Float64Array(maxHp + 1);
    });
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
    Math.max(0, Math.min(1000, options.startingEnergy)),
    Math.max(0, options.maxSpecs),
    makeInitialState(maxHp, initialReductions),
    [],
    0,
  );

  const rankedResults = results
    .filter((result) => result.attacks.length > 0)
    .sort((a, b) => a.expectedSeconds - b.expectedSeconds)
    .slice(0, MAX_RESULTS);
  const adaptiveCandidates = rankedResults.map((result) => {
    const firstAttack = result.attacks[0];
    if (!DEFENCE_REDUCTION_SPEC_WEAPONS.includes(firstAttack.weaponName)) {
      return { result, ranges: [] as SpecSwapAdaptiveRange[] };
    }
    const energyAfterFirst = result.remainingEnergy + result.attacks
      .slice(1)
      .reduce((energy, attack) => energy + attack.specCost, 0);
    return {
      result,
      ranges: buildAdaptiveFollowUps(
        firstAttack,
        energyAfterFirst,
        specCandidates,
        maxHp,
        initialReductions,
        getAttackCandidate,
        getFinisherMemory,
      ),
    };
  });
  const bestAdaptive = adaptiveCandidates
    .filter(({ ranges }) => ranges.length > 1)
    .sort((a, b) => a.result.expectedSeconds - b.result.expectedSeconds)[0];

  return rankedResults.map((result) => {
    if (!bestAdaptive || bestAdaptive.result !== result) {
      return result;
    }
    return {
      ...result,
      adaptive: true,
      adaptiveFollowUps: bestAdaptive.ranges,
    };
  });
};
