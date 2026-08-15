/* eslint-disable no-restricted-globals */
import { computeSpecWeaponSwaps } from '@/lib/SpecWeaponSwap';
import { WORKER_JSON_REPLACER, WORKER_JSON_REVIVER } from '@/utils';
import type { SpecSwapResult } from '@/lib/SpecWeaponSwap';
import type { Monster } from '@/types/Monster';
import type { Player } from '@/types/Player';

export interface SpecSwapResultsWorkerRequest {
  loadouts: Player[],
  monster: Monster,
  startingEnergy: number,
  maxSpecs: number,
}

export interface SpecSwapResultsWorkerResponse {
  error?: string,
  payload?: SpecSwapResult[],
}

self.onmessage = (evt: MessageEvent<string>) => {
  try {
    const request = JSON.parse(evt.data, WORKER_JSON_REVIVER) as SpecSwapResultsWorkerRequest;
    const payload = computeSpecWeaponSwaps(
      request.loadouts,
      request.monster,
      {
        startingEnergy: request.startingEnergy,
        maxSpecs: request.maxSpecs,
      },
    );
    self.postMessage(JSON.stringify({ payload }, WORKER_JSON_REPLACER));
  } catch (e: unknown) {
    self.postMessage(JSON.stringify({
      error: e instanceof Error ? e.message : `Unknown error type: ${e}`,
    }, WORKER_JSON_REPLACER));
  }
};

export {};
