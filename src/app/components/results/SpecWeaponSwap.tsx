import React, { useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { IconAlertTriangle, IconSwords } from '@tabler/icons-react';
import { toJS } from 'mobx';
import { useStore } from '@/state';
import SectionAccordion from '@/app/components/generic/SectionAccordion';
import NumberInput from '@/app/components/generic/NumberInput';
import { computeSpecWeaponSwaps } from '@/lib/SpecWeaponSwap';

const warningClassName = [
  'w-full bg-yellow-500 text-white px-4 py-1 text-sm border-yellow-400',
  'flex items-center gap-2',
].join(' ');

const SpecWeaponSwap: React.FC = observer(() => {
  const store = useStore();
  const [startingEnergy, setStartingEnergy] = useState(100);
  const [maxSpecs, setMaxSpecs] = useState(4);
  const loadouts = toJS(store.loadouts);
  const monster = toJS(store.monster);

  const specLoadouts = loadouts.filter((loadout) => loadout.specSetup);
  const normalLoadouts = loadouts.filter((loadout) => !loadout.specSetup);
  const results = useMemo(
    () => computeSpecWeaponSwaps(loadouts, monster, { startingEnergy, maxSpecs }),
    [loadouts, monster, startingEnergy, maxSpecs],
  );

  return (
    <SectionAccordion
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
        <div className="mb-4 flex flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <span>Starting spec energy</span>
            <NumberInput
              id="spec-swap-starting-energy"
              aria-label="Starting spec energy"
              className="form-control w-20"
              min={0}
              max={100}
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
                {results.map((result, i) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <tr key={`${i}-${result.attacks.map((attack) => attack.loadoutName).join('-')}`}>
                    <td className="px-4 py-1.5 border-r">{i + 1}</td>
                    <td className="px-4 py-1.5 border-r">
                      <div className="flex flex-col gap-1">
                        {result.attacks.map((attack, attackIx) => (
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SectionAccordion>
  );
});

export default SpecWeaponSwap;
