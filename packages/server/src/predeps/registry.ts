import { makeAigatewayPredep } from "./aigateway.ts";
import { makeOpencodePredep } from "./opencode.ts";
import { clickhousePredep } from "./clickhouse.ts";
import { goosePredep } from "./goose.ts";
import { pnpmPredep } from "./pnpm.ts";
import { postgresPredep } from "./postgres.ts";
import { redisPredep } from "./redis.ts";
import { uvPredep } from "./uv.ts";
import { resolveFeatures } from "../shared/features.ts";
import type { Predep } from "./types.ts";

export function predepRegistry({ version }: { version: string }): Predep[] {
  // pnpm comes FIRST so the bundled binary is in place before
  // ensureLangwatchDeps + runMigrations call resolvePnpm(paths). uv is
  // fast/cached so its position is mostly irrelevant; everything else
  // doesn't depend on pnpm.
  // The assistant's runtime is last: it is the only optional one, and the
  // only one whose failure leaves a working install behind.
  const features = resolveFeatures();
  return [
    pnpmPredep,
    uvPredep,
    postgresPredep,
    redisPredep,
    clickhousePredep,
    goosePredep,
    makeAigatewayPredep(version),
    makeOpencodePredep({ enabled: features.langy }),
  ];
}
