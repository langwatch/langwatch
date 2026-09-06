import { makeAigatewayPredep } from "./aigateway.ts";
import { clickhousePredep } from "./clickhouse.ts";
import { goosePredep } from "./goose.ts";
import { makeLangyWorkerPredep } from "./langy-worker.ts";
import { pnpmPredep } from "./pnpm.ts";
import { postgresPredep } from "./postgres.ts";
import { redisPredep } from "./redis.ts";
import { uvPredep } from "./uv.ts";
import type { Predep } from "./types.ts";

export function predepRegistry({
  version,
  isLangyEnabled,
}: {
  version: string;
  isLangyEnabled: boolean;
}): Predep[] {
  // pnpm comes FIRST so the bundled binary is in place before
  // ensureLangwatchDeps + runMigrations call resolvePnpm(paths). uv is
  // fast/cached so its position is mostly irrelevant; everything else
  // doesn't depend on pnpm.
  //
  // The worker is last and feature-gated: an install that disables Langy must
  // not download a per-conversation runtime it will never execute.
  return [
    pnpmPredep,
    uvPredep,
    postgresPredep,
    redisPredep,
    clickhousePredep,
    goosePredep,
    makeAigatewayPredep(version),
    makeLangyWorkerPredep({ isEnabled: isLangyEnabled, serverVersion: version }),
  ];
}
