/**
 * Kept separate so importing the router or app type never pulls in the
 * installer: the scenario surface reads `suites` for `ctx.app`, and the run
 * dialog's own composition names this type without booting the feature.
 */
import type { MountableRestApp } from "@langwatch/api/rest";
import type { SuiteApi } from "@langwatch/suite-contract";
import type { ApiTrpcFeatureMount } from "../../api.application.ts";
import type { createSuiteTrpcRouter } from "./suite-trpc.mount.ts";

/** The one namespace this feature mounts, and the app slice `ctx.app` reads. */
export type ComposedSuiteFeature = Readonly<{
  /** `suites.*`, with `suites.testSuites.*` under it, on the process's own root. */
  routers(mount: ApiTrpcFeatureMount): {
    suites: ReturnType<typeof createSuiteTrpcRouter>;
  };
  /**
   * For `ctx.app.suites`, for the scenario runner that schedules through it,
   * and for the three REST families that answer out of the same application.
   */
  app: SuiteApi;
  /**
   * `/api/v1/run-plans`, `/api/v1/test-suites` and the deprecated
   * `/api/suites` alias, bound to this process's project-key door.
   */
  rest: readonly MountableRestApp[];
}>;
