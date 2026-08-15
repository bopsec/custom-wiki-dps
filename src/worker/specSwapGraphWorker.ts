/* eslint-disable no-restricted-globals */
import { computeSpecWeaponSwapGraph } from '@/lib/SpecWeaponSwap';
import { WORKER_JSON_REPLACER, WORKER_JSON_REVIVER } from '@/utils';
import type {
  SpecSwapAttack,
  SpecSwapMode,
  SpecSwapOutcomeOverride,
} from '@/lib/SpecWeaponSwap';
import type { Monster } from '@/types/Monster';
import type { Player } from '@/types/Player';

export interface SpecSwapGraphWorkerRequest {
  loadouts: Player[],
  monster: Monster,
  attacks: SpecSwapAttack[],
  overrides: SpecSwapOutcomeOverride[],
  continuous: boolean,
}

export interface SpecSwapGraphWorkerResponse {
  error?: string,
  payload?: SpecSwapMode,
}

self.onmessage = (evt: MessageEvent<string>) => {
  try {
    const request = JSON.parse(evt.data, WORKER_JSON_REVIVER) as SpecSwapGraphWorkerRequest;
    const payload = computeSpecWeaponSwapGraph(
      request.loadouts,
      request.monster,
      request.attacks,
      request.overrides,
      request.continuous,
    );
    self.postMessage(JSON.stringify({ payload }, WORKER_JSON_REPLACER));
  } catch (e: unknown) {
    self.postMessage(JSON.stringify({
      error: e instanceof Error ? e.message : `Unknown error type: ${e}`,
    }, WORKER_JSON_REPLACER));
  }
};

export {};
