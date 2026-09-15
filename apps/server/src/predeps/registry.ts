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
  // pnpm first, assistant runtime last (optional). Feature-gated.
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
