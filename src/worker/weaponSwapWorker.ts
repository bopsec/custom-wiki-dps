/* eslint-disable no-restricted-globals */
import { computeWeaponSwap } from '@/lib/WeaponSwap';
import { WORKER_JSON_REPLACER, WORKER_JSON_REVIVER } from '@/utils';
import type { WeaponSwapResult } from '@/lib/WeaponSwap';
import type { Monster } from '@/types/Monster';
import type { WorkerCalcOpts } from '@/worker/CalcWorkerTypes';
import type { Player } from '@/types/Player';

export interface WeaponSwapWorkerRequest {
  loadouts: Player[],
  monster: Monster,
  calcOpts: WorkerCalcOpts,
}

export interface WeaponSwapWorkerResponse {
  error?: string,
  payload?: WeaponSwapResult | null,
}

self.onmessage = (evt: MessageEvent<string>) => {
  try {
    const request = JSON.parse(evt.data, WORKER_JSON_REVIVER) as WeaponSwapWorkerRequest;
    const payload = computeWeaponSwap(request.loadouts, request.monster, request.calcOpts) || null;
    self.postMessage(JSON.stringify({ payload }, WORKER_JSON_REPLACER));
  } catch (e: unknown) {
    self.postMessage(JSON.stringify({
      error: e instanceof Error ? e.message : `Unknown error type: ${e}`,
    }, WORKER_JSON_REPLACER));
  }
};

export {};
