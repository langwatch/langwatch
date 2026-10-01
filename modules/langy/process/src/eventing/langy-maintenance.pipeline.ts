/**
 * Langy's own maintenance sweep (ADR-144): hourly revocation of elapsed
 * session keys, no events and no commands of its own. Ported from the
 * deleted `LangyMaintenanceWorkerFeatureInstaller`.
 */
import { defineEventingModule, type EventingSetup } from "@langwatch/eventing";

import type { LangyApp } from "../app/langy.app.ts";
import type { LangyRepositories } from "../repositories/langy-repositories.registry.ts";

export const langyMaintenanceEventing = defineEventingModule({
  pipeline: "langy_maintenance",
  build: ({ app, processStore }: EventingSetup<LangyRepositories, LangyApp>) =>
    app.maintenanceEventingPipeline({
      deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
    }),
});
