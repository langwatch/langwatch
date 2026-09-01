import { makeAigatewayPredep } from "./aigateway.ts";
import { clickhousePredep } from "./clickhouse.ts";
import { goosePredep } from "./goose.ts";
import { pnpmPredep } from "./pnpm.ts";
import { postgresPredep } from "./postgres.ts";
import { redisPredep } from "./redis.ts";
import { uvPredep } from "./uv.ts";
import type { Predep } from "./types.ts";

export function predepRegistry({ version }: { version: string }): Predep[] {
  // pnpm comes FIRST so the bundled binary is in place before
  // ensureLangwatchDeps + runMigrations call resolvePnpm(paths). uv is
  // fast/cached so its position is mostly irrelevant; everything else
  // doesn't depend on pnpm.
  //
  // Every predep here is required. The assistant's coding-agent runtime was
  // the one optional entry — gated on LANGWATCH_ENABLE_LANGY so a disabled
  // assistant did not download ~45MB it would never run — and ADR-131
  // removed the harness that binary was.
  return [
    pnpmPredep,
    uvPredep,
    postgresPredep,
    redisPredep,
    clickhousePredep,
    goosePredep,
    makeAigatewayPredep(version),
  ];
}
