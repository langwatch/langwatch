/**
 * The Experiments family's typed tRPC hooks, on the application's transport
 * and React Query cache. Mounted by `experiment.web.ts` through `.withApi`.
 */

import { createModuleApi } from "@langwatch/api/web";

import type { ExperimentApiMap } from "../model/experiment-api-map.ts";

export const experimentApi = createModuleApi<ExperimentApiMap>();
