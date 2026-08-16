import React, {
  useEffect, useMemo, useRef, useState,
} from 'react';
import { observer } from 'mobx-react-lite';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  TooltipProps,
  XAxis,
  YAxis,
} from 'recharts';
import { max } from 'd3-array';
import {
  IconAlertTriangle,
  IconChartLine,
  IconInfoCircle,
  IconSwords,
} from '@tabler/icons-react';
import { toJS } from 'mobx';
import { useStore } from '@/state';
import SectionAccordion from '@/app/components/generic/SectionAccordion';
import NumberInput from '@/app/components/generic/NumberInput';
import { WORKER_JSON_REPLACER, WORKER_JSON_REVIVER } from '@/utils';
import type {
  SpecSwapMode,
  SpecSwapOutcomeOverride,
  SpecSwapRange,
  SpecSwapResult,
} from '@/lib/SpecWeaponSwap';
import type { Player } from '@/types/Player';
import type { Monster } from '@/types/Monster';
import type {
  SpecSwapGraphWorkerRequest,
  SpecSwapGraphWorkerResponse,
} from '@/worker/specSwapGraphWorker';
import type {
  SpecSwapResultsWorkerRequest,
  SpecSwapResultsWorkerResponse,
} from '@/worker/specSwapResultsWorker';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';

enum SwapMode {
  CONTINUOUS,
  DISCONTINUOUS,
}

const modeOptions = [
  {
    label: 'Continuous',
    value: SwapMode.CONTINUOUS,
    description: 'Assumes attacks continue naturally after the monster dies.',
  },
  {
    label: 'Discontinuous',
    value: SwapMode.DISCONTINUOUS,
    description: 'Shows swap breakpoints with the final attack cycle removed.',
  },
];

const warningClassName = [
  'w-full bg-yellow-500 text-white px-4 py-1 text-sm border-yellow-400',
  'flex items-center gap-2',
].join(' ');

const strokeColours = ['cyan', 'yellow', 'lime', 'orange', 'pink', '#8B9BE8'];
const damageOverrideWeapons = ['Bandos godsword', 'Eye of ayak'];
const hitMissOverrideWeapons = [
  'Dragon warhammer',
  'Elder maul',
  'Arclight',
  'Emberlight',
  'Tonalztics of ralos',
  'Accursed sceptre',
  'Accursed sceptre (a)',
];

const formatRange = (range: SpecSwapRange): string => (
  range.fromHp === range.toHp
    ? `${range.fromHp} HP`
    : `${range.toHp}-${range.fromHp} HP`
);

type SpecSwapChartEntry = {
  name: string,
  hitpoints: number,
  weaponOnlySeconds: number,
  [loadoutName: string]: string | number | null,
};

const CustomTooltip: React.FC<TooltipProps<ValueType, NameType>> = ({
  active,
  payload,
  label,
}) => {
  const visiblePayload = payload?.filter((p) => p.value !== null && p.value !== undefined);

  if (active && visiblePayload && visiblePayload.length) {
    const point = visiblePayload[0].payload as SpecSwapChartEntry;
    return (
      <div className="bg-white shadow rounded p-2 text-sm text-black flex items-center gap-2">
        <div>
          <p>
            <strong>
              {label}
              {' '}
              HP
            </strong>
          </p>
          {visiblePayload.map((p) => (
            <div key={p.name} className="flex justify-between w-44 gap-2">
              <div className="flex items-center gap-1 leading-3 overflow-hidden">
                <div>
                  <div
                    className="w-3 h-3 inline-block border border-gray-400 rounded-lg"
                    style={{ backgroundColor: p.color }}
                  />
                </div>
                {p.name}
              </div>
              <span className="text-gray-400 font-bold">
                {p.value === 'NaN' ? '---' : `${p.value}s`}
              </span>
            </div>
          ))}
          <div className="mt-1 flex justify-between w-44 gap-2 text-xs">
            <span className="text-gray-500">Camp this setup only</span>
            <span className="text-gray-400 font-bold">
              {point.weaponOnlySeconds.toFixed(2)}
              s
            </span>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

const getOverride = (
  overrides: SpecSwapOutcomeOverride[],
  attackIndex: number,
): SpecSwapOutcomeOverride => (
  overrides.find((override) => override.attackIndex === attackIndex) || { attackIndex, mode: 'average' }
);

const PostSpecSwapGraph: React.FC<{
  loadouts: Player[],
  monster: Monster,
  result: SpecSwapResult,
}> = ({ loadouts, monster, result }) => {
  const workerRef = useRef<Worker | null>(null);
  const [mode, setMode] = useState(modeOptions[0]);
  const [overrides, setOverrides] = useState<SpecSwapOutcomeOverride[]>([]);
  const [swap, setSwap] = useState<SpecSwapMode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasOverrides = overrides.length > 0;
  const activeSwap = swap;
  const outcomeControls = result.attacks
    .map((attack, attackIndex) => ({ attack, attackIndex }))
    .filter(({ attack }) => (
      damageOverrideWeapons.includes(attack.weaponName)
      || hitMissOverrideWeapons.includes(attack.weaponName)
    ));
  const updateOverride = (override: SpecSwapOutcomeOverride) => setOverrides((prev) => (
    override.mode === 'average'
      ? prev.filter((o) => o.attackIndex !== override.attackIndex)
      : [...prev.filter((o) => o.attackIndex !== override.attackIndex), override]
  ));

  useEffect(() => {
    let cancelled = false;
    workerRef.current?.terminate();
    setLoading(true);
    setError(null);
    setSwap(null);

    const worker = new Worker(new URL('../../../worker/specSwapGraphWorker.ts', import.meta.url));
    workerRef.current = worker;
    worker.onmessage = (evt: MessageEvent<string>) => {
      if (!cancelled) {
        const response = JSON.parse(evt.data, WORKER_JSON_REVIVER) as SpecSwapGraphWorkerResponse;
        if (response.error) {
          setError(response.error);
        } else {
          setSwap(response.payload || null);
        }
        setLoading(false);
      }
      worker.terminate();
      if (workerRef.current === worker) {
        workerRef.current = null;
      }
    };
    worker.onerror = (e: ErrorEvent) => {
      if (!cancelled) {
        setError(e.message);
        setLoading(false);
      }
      worker.terminate();
      if (workerRef.current === worker) {
        workerRef.current = null;
      }
    };
    worker.postMessage(JSON.stringify({
      loadouts,
      monster,
      attacks: result.attacks,
      overrides,
      continuous: mode.value === SwapMode.CONTINUOUS,
    } satisfies SpecSwapGraphWorkerRequest, WORKER_JSON_REPLACER));

    return () => {
      cancelled = true;
      worker.terminate();
      if (workerRef.current === worker) {
        workerRef.current = null;
      }
    };
  }, [loadouts, mode.value, monster, overrides, result.attacks]);

  const yDomainMax = useMemo(() => {
    const high = max(activeSwap?.points || [], (point) => point.expectedSeconds) || 1;
    return Math.ceil(high);
  }, [activeSwap]);

  const chartData = useMemo((): SpecSwapChartEntry[] => (activeSwap?.points || []).map((point) => {
    const entry: SpecSwapChartEntry = {
      name: point.hitpoints.toString(),
      hitpoints: point.hitpoints,
      weaponOnlySeconds: point.weaponOnlyExpectedSeconds,
    };
    activeSwap?.loadouts.forEach((loadout) => {
      entry[loadout.loadoutName] = null;
    });
    entry[point.loadoutName] = parseFloat(point.expectedSeconds.toFixed(2));
    return entry;
  }).reverse(), [activeSwap]);

  const ranges = useMemo(
    () => [...(activeSwap?.ranges || [])].sort((a, b) => b.toHp - a.toHp),
    [activeSwap],
  );

  return (
    <div className="px-4 py-4 bg-body-200 dark:bg-dark-400">
      {outcomeControls.length > 0 && (
        <div className="mb-4 flex flex-col gap-3 text-sm text-black dark:text-body-200">
          {outcomeControls.map(({ attack, attackIndex }) => {
            const override = getOverride(overrides, attackIndex);
            const averageDamage = Math.max(0, Math.min(attack.maxHit, Math.round(attack.expectedDamage)));
            return (
              <div key={`${attackIndex}-${attack.loadoutName}`} className="flex flex-wrap items-center gap-3">
                <span className="min-w-32 font-bold">
                  {attackIndex + 1}
                  .
                  {' '}
                  {attack.loadoutName}
                </span>
                {damageOverrideWeapons.includes(attack.weaponName) && (
                  <>
                    <input
                      type="range"
                      min={0}
                      max={attack.maxHit}
                      value={override.mode === 'damage' ? override.damage || 0 : averageDamage}
                      onChange={(e) => updateOverride({
                        attackIndex,
                        mode: 'damage',
                        damage: Number(e.target.value),
                      })}
                      className="w-48"
                    />
                    <NumberInput
                      id={`spec-swap-outcome-${attackIndex}`}
                      aria-label={`${attack.loadoutName} damage`}
                      className="form-control w-20"
                      min={0}
                      max={attack.maxHit}
                      value={override.mode === 'damage' ? override.damage || 0 : averageDamage}
                      onChange={(value) => updateOverride({
                        attackIndex,
                        mode: 'damage',
                        damage: value,
                      })}
                    />
                    <span className="text-xs text-gray-500 dark:text-gray-300">
                      {override.mode === 'average' ? 'average' : `max ${attack.maxHit}`}
                    </span>
                  </>
                )}
                {hitMissOverrideWeapons.includes(attack.weaponName) && (
                  <div className="flex gap-1">
                    {(['average', 'hit', 'miss'] as const).map((outcome) => (
                      <button
                        key={outcome}
                        type="button"
                        onClick={() => updateOverride({ attackIndex, mode: outcome })}
                        className={`px-3 py-1 border text-sm capitalize transition-colors ${
                          override.mode === outcome
                            ? 'bg-orange-400 dark:bg-orange-700 border-orange-500 text-white'
                            : 'bg-btns-400 dark:bg-dark-500 border-body-100 dark:border-dark-300'
                        }`}
                      >
                        {outcome}
                      </button>
                    ))}
                  </div>
                )}
                {override.mode !== 'average' && (
                  <button
                    type="button"
                    onClick={() => updateOverride({ attackIndex, mode: 'average' })}
                    className="px-3 py-1 border text-sm bg-btns-400 dark:bg-dark-500 border-body-100 dark:border-dark-300"
                  >
                    Reset to average
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {loading && (
        <div className="flex h-64 items-center justify-center text-black dark:text-body-200">
          Loading spec swap graph...
        </div>
      )}
      {error && (
        <div className={`${warningClassName} mb-4 border`}>
          <IconAlertTriangle className="text-orange-200" />
          <div>{error}</div>
        </div>
      )}
      {!loading && !error && activeSwap && (
        <ResponsiveContainer width="100%" height={250}>
          <LineChart
            data={chartData}
            margin={{
              top: 40, right: 20, bottom: 10, left: 0,
            }}
          >
            <XAxis
              allowDecimals={false}
              dataKey="hitpoints"
              stroke="#777777"
              interval="equidistantPreserveStart"
              label={{ value: hasOverrides ? 'Monster HP after selected specs' : 'Monster HP after expected specs', position: 'insideBottom', offset: -10 }}
            />
            <YAxis
              stroke="#777777"
              domain={[0, yDomainMax]}
              tickFormatter={(v: number) => `${parseFloat(v.toFixed(1))}`}
              label={{
                value: 'Seconds', position: 'insideLeft', angle: -90, style: { textAnchor: 'middle' },
              }}
            />
            <CartesianGrid stroke="gray" strokeDasharray="5 5" />
            <Tooltip
              filterNull
              content={(props) => <CustomTooltip {...props} />}
            />
            <Legend wrapperStyle={{ fontSize: '.9em', top: 0 }} />
            {activeSwap.loadouts.map((loadout) => (
              <Line
                key={loadout.loadoutIndex}
                type="monotone"
                dataKey={loadout.loadoutName}
                stroke={strokeColours[loadout.loadoutIndex % strokeColours.length]}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
      <div className="mt-4 flex flex-wrap gap-2 dark:text-white">
        {modeOptions.map((opt) => (
          <button
            key={opt.value}
            type="button"
            title={opt.description}
            onClick={() => setMode(opt)}
            className={`px-3 py-1 border text-sm transition-colors ${
              mode.value === opt.value
                ? 'bg-orange-400 dark:bg-orange-700 border-orange-500 text-white'
                : 'bg-btns-400 dark:bg-dark-500 border-body-100 dark:border-dark-300'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {!loading && !error && activeSwap && (
      <div className="mt-4 overflow-x-auto text-black dark:text-body-200">
        <table className="w-full">
          <thead>
            <tr>
              <th className="text-left px-4 py-1.5 border-r bg-btns-400 dark:bg-dark-500 dark:text-white">
                Monster HP
              </th>
              <th className="text-left px-4 py-1.5 bg-btns-400 dark:bg-dark-500 dark:text-white">
                Use loadout
              </th>
            </tr>
          </thead>
          <tbody>
            {ranges.map((range) => (
              <tr key={`${range.loadoutIndex}-${range.fromHp}-${range.toHp}`}>
                <td className="px-4 py-1.5 border-r">{formatRange(range)}</td>
                <td className="px-4 py-1.5">
                  <span className="flex items-center gap-1">
                    <span
                      className="w-3 h-3 inline-block border border-gray-400 rounded-lg"
                      style={{ backgroundColor: strokeColours[range.loadoutIndex % strokeColours.length] }}
                    />
                    {range.loadoutName}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
};

const SpecWeaponSwap: React.FC = observer(() => {
  const store = useStore();
  const [startingEnergy, setStartingEnergy] = useState(100);
  const [maxSpecs, setMaxSpecs] = useState(4);
  const [isOpen, setIsOpen] = useState(false);
  const [expandedResult, setExpandedResult] = useState<string | null>(null);
  const loadouts = toJS(store.loadouts);
  const monster = toJS(store.monster);
  const loadoutsKey = JSON.stringify(loadouts);
  const monsterKey = JSON.stringify(monster);
  const loadoutsSnapshot = useMemo(() => JSON.parse(loadoutsKey) as Player[], [loadoutsKey]);
  const monsterSnapshot = useMemo(() => JSON.parse(monsterKey) as Monster, [monsterKey]);

  const specLoadouts = loadouts.filter((loadout) => loadout.specSetup);
  const normalLoadouts = loadouts.filter((loadout) => !loadout.specSetup);
  const [results, setResults] = useState<SpecSwapResult[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || specLoadouts.length === 0 || normalLoadouts.length === 0) {
      setResults([]);
      setResultsLoading(false);
      setResultsError(null);
      return undefined;
    }

    let cancelled = false;
    const worker = new Worker(new URL('../../../worker/specSwapResultsWorker.ts', import.meta.url));
    setResults([]);
    setResultsLoading(true);
    setResultsError(null);

    worker.onmessage = (evt: MessageEvent<string>) => {
      if (!cancelled) {
        const response = JSON.parse(evt.data, WORKER_JSON_REVIVER) as SpecSwapResultsWorkerResponse;
        if (response.error) {
          setResultsError(response.error);
        } else {
          setResults(response.payload || []);
        }
        setResultsLoading(false);
      }
      worker.terminate();
    };
    worker.onerror = (e: ErrorEvent) => {
      if (!cancelled) {
        setResultsError(e.message || 'Unable to calculate spec swaps.');
        setResultsLoading(false);
      }
      worker.terminate();
    };
    worker.postMessage(JSON.stringify({
      loadouts: loadoutsSnapshot,
      monster: monsterSnapshot,
      startingEnergy,
      maxSpecs,
    } satisfies SpecSwapResultsWorkerRequest, WORKER_JSON_REPLACER));

    return () => {
      cancelled = true;
      worker.terminate();
    };
  }, [
    isOpen,
    loadoutsSnapshot,
    monsterSnapshot,
    maxSpecs,
    normalLoadouts.length,
    specLoadouts.length,
    startingEnergy,
  ]);

  return (
    <SectionAccordion
      onIsOpenChanged={(open) => {
        setIsOpen(open);
        if (!open) {
          setExpandedResult(null);
        }
      }}
      title={(
        <div className="flex items-center gap-2">
          <IconSwords size={22} />
          <h3 className="font-serif font-bold">
            Optimal Weapon Swaps with Specs
          </h3>
        </div>
      )}
    >
      {(specLoadouts.length === 0 || normalLoadouts.length === 0) && (
        <div className={`${warningClassName} border-b`}>
          <IconAlertTriangle className="text-orange-200" />
          <div>Add at least one spec setup and one regular DPS loadout.</div>
        </div>
      )}
      <div className="px-6 py-4 text-sm dark:text-white">
        {specLoadouts.length === 0 && (
          <div className="mb-4 border border-body-300 dark:border-dark-200 bg-body-100 dark:bg-dark-500 px-4 py-3 text-black dark:text-body-200">
            <div className="mb-2 flex items-center gap-2 font-bold dark:text-white">
              <IconInfoCircle size={18} />
              <span>Spec setup guide</span>
            </div>
            <ol className="list-decimal pl-5 leading-6">
              <li>Create or duplicate a loadout for the spec weapon.</li>
              <li>Equip the spec weapon and any gear used only for that special attack.</li>
              <li>Open that loadout&apos;s extra options and enable Spec setup.</li>
              <li>Keep your normal DPS loadouts unchecked so they are used after the specs.</li>
            </ol>
          </div>
        )}
        <div className="mb-4 flex flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <span>Starting spec energy</span>
            <NumberInput
              id="spec-swap-starting-energy"
              aria-label="Starting spec energy"
              className="form-control w-20"
              min={0}
              max={1000}
              value={startingEnergy}
              onChange={(value) => setStartingEnergy(value)}
            />
            <span>%</span>
          </div>
          <div className="flex items-center gap-2">
            <span>Max opening specs</span>
            <NumberInput
              id="spec-swap-max-specs"
              aria-label="Max opening specs"
              className="form-control w-16"
              min={1}
              max={10}
              value={maxSpecs}
              onChange={(value) => setMaxSpecs(value)}
            />
          </div>
        </div>
        {resultsLoading && (
          <div className="mb-4 flex h-16 items-center justify-center border border-body-300 dark:border-dark-200 bg-body-100 dark:bg-dark-500 text-black dark:text-body-200">
            Loading spec swap results...
          </div>
        )}
        {resultsError && (
          <div className={`${warningClassName} mb-4 border`}>
            <IconAlertTriangle className="text-orange-200" />
            <div>
              Unable to calculate spec swaps:
              {' '}
              {resultsError}
            </div>
          </div>
        )}
        {results.length > 0 && (
          <div className="overflow-x-auto text-black dark:text-body-200">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left px-4 py-1.5 border-r bg-btns-400 dark:bg-dark-500 dark:text-white">
                    Rank
                  </th>
                  <th className="text-left px-4 py-1.5 border-r bg-btns-400 dark:bg-dark-500 dark:text-white">
                    Opening specs
                  </th>
                  <th className="text-left px-4 py-1.5 border-r bg-btns-400 dark:bg-dark-500 dark:text-white">
                    Finish with
                  </th>
                  <th className="text-right px-4 py-1.5 border-r bg-btns-400 dark:bg-dark-500 dark:text-white">
                    Expected time
                  </th>
                  <th className="text-right px-4 py-1.5 border-r bg-btns-400 dark:bg-dark-500 dark:text-white">
                    Spec damage
                  </th>
                  <th className="text-right px-4 py-1.5 bg-btns-400 dark:bg-dark-500 dark:text-white">
                    Energy left
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.map((result, i) => {
                  const resultKey = `${i}-${result.attacks.map((attack) => attack.loadoutName).join('-')}`;
                  const isExpanded = expandedResult === resultKey;
                  return (
                    <React.Fragment key={resultKey}>
                      <tr>
                        <td className="px-4 py-1.5 border-r">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              title="Show post-spec swap graph"
                              aria-label={`${isExpanded ? 'Hide' : 'Show'} post-spec swap graph for rank ${i + 1}`}
                              onClick={() => setExpandedResult(isExpanded ? null : resultKey)}
                              className={`p-1 border transition-colors ${
                                isExpanded
                                  ? 'bg-orange-400 dark:bg-orange-700 border-orange-500 text-white'
                                  : 'bg-btns-400 dark:bg-dark-500 border-body-100 dark:border-dark-300'
                              }`}
                            >
                              <IconChartLine size={16} aria-hidden />
                            </button>
                            <span>{i + 1}</span>
                          </div>
                        </td>
                        <td className="px-4 py-1.5 border-r">
                          <div className="flex flex-col gap-1">
                            {result.attacks.slice(0, result.adaptive ? 1 : undefined).map((attack, attackIx) => (
                              // eslint-disable-next-line react/no-array-index-key
                              <span key={`${attackIx}-${attack.loadoutName}-${attack.weaponName}`}>
                                {attackIx + 1}
                                .
                                {' '}
                                {attack.loadoutName}
                                {' '}
                                <span className="text-xs text-gray-500 dark:text-gray-300">
                                  (
                                  {attack.weaponName}
                                  ,
                                  {' '}
                                  {attack.specCost}
                                  %)
                                </span>
                              </span>
                            ))}
                            {result.adaptive && (
                              <span className="text-xs font-bold text-orange-700 dark:text-orange-300">
                                +
                                {' '}
                                {[...new Set(result.adaptiveFollowUps?.map((range) => range.loadoutName) || [])].join(' / ')}
                                {' '}
                                (Adaptive)
                              </span>
                            )}
                            {result.adaptiveFollowUps && result.adaptiveFollowUps.length > 0 && (
                              <div className="mt-1 text-xs text-orange-700 dark:text-orange-300">
                                Adaptive next spec after
                                {' '}
                                {result.attacks[0].weaponName}
                                {' '}
                                hit:
                                {' '}
                                {result.adaptiveFollowUps.map((range, rangeIx) => (
                                  <React.Fragment key={`${range.fromDamage}-${range.toDamage}-${range.loadoutName}`}>
                                    {rangeIx > 0 && ', '}
                                    {range.fromDamage === range.toDamage
                                      ? `${range.fromDamage}`
                                      : `${range.fromDamage}-${range.toDamage}`}
                                    {' '}
                                    {range.loadoutName}
                                  </React.Fragment>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-1.5 border-r">{result.finisherName}</td>
                        <td className="px-4 py-1.5 border-r text-right">
                          {result.expectedSeconds.toFixed(2)}
                          s
                        </td>
                        <td className="px-4 py-1.5 border-r text-right">
                          {result.expectedSpecDamage.toFixed(2)}
                        </td>
                        <td className="px-4 py-1.5 text-right">
                          {result.remainingEnergy}
                          %
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={6} className="p-0">
                            <span className="sr-only">
                              Post-spec swap graph for rank
                              {' '}
                              {i + 1}
                            </span>
                            <PostSpecSwapGraph
                              loadouts={loadouts}
                              monster={monster}
                              result={result}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SectionAccordion>
  );
});

export default SpecWeaponSwap;
