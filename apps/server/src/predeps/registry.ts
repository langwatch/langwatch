import { makeAigatewayPredep } from "./aigateway.ts";
import { makeOpencodePredep } from "./opencode.ts";
import { clickhousePredep } from "./clickhouse.ts";
import { goosePredep } from "./goose.ts";
import { pnpmPredep } from "./pnpm.ts";
import { makePostgresPredep } from "./postgres.ts";
import { redisPredep } from "./redis.ts";
import { uvPredep } from "./uv.ts";
import { resolveEffectiveFeatures } from "../shared/features.ts";
import { paths } from "../shared/paths.ts";
import type { Predep } from "./types.ts";
import type { LocalOrchestratorDevelopmentConfig } from "../platform/config/local-orchestrator.config.ts";

export function predepRegistry({
  version,
  development,
}: {
  version: string;
  development: LocalOrchestratorDevelopmentConfig;
}): Predep[] {
  // pnpm comes FIRST so the bundled binary is in place before
  // ensureLangwatchDeps + runMigrations call resolvePnpm(paths). uv is
  // fast/cached so its position is mostly irrelevant; everything else
  // doesn't depend on pnpm.
  // The assistant's runtime is last: it is the only optional one, and the
  // only one whose failure leaves a working install behind.
  // Resolved the same way the runtime resolves them (persisted .env first,
  // shell on top): a LANGWATCH_ENABLE_LANGY=false line in ~/.langwatch/.env
  // must stop the assistant runtime from being downloaded, not only from
  // being started.
  const features = resolveEffectiveFeatures(paths.envFile);
  return [
    pnpmPredep,
    uvPredep,
    makePostgresPredep(development),
    redisPredep,
    clickhousePredep,
    goosePredep,
    makeAigatewayPredep({ version, development }),
    makeOpencodePredep({ isEnabled: features.isLangyEnabled }),
  ];
}
