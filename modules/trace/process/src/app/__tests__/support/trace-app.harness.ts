import type { AuthzApi } from "@langwatch/authz-contract";
import { planSchema } from "@langwatch/entitlement-contract";
import type { PlanType } from "@langwatch/plans";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

import { MemoryNullTraceBraidReadsRepository } from "../../../features/braid/repositories/memory/memory.null-trace-braid-reads.repository.ts";
import { TraceModule, type TraceAppDependencies } from "../../trace.app.ts";

type TraceReaders = TraceAppDependencies["traces"];

/** A plan seam answering one plan type for every organisation; `FREE` pauses braids (§9). */
export function braidPlansOf(type: PlanType = "FREE"): TraceAppDependencies["braidPlans"] {
  return {
    getActivePlan: async () =>
      planSchema.parse({
        planSource: "subscription",
        type,
        name: type,
        free: type === "FREE",
        maxMessagesPerMonth: 0,
        maxMembers: 0,
        maxMembersLite: 0,
        canPublish: true,
        prices: { USD: 0, EUR: 0 },
      }),
  };
}

/** The braid peers by name: a test that reaches one it did not configure fails by its name. */
export function braidTwins(): Pick<
  TraceAppDependencies,
  "braidPlans" | "braidDirectory" | "braidPrices"
> {
  return {
    braidPlans: braidPlansOf(),
    braidDirectory: {
      authz: createApiFixture<AuthzApi>({}, "braidAuthz"),
      projects: createApiFixture<ProjectApi>({}, "braidProjects"),
    },
    braidPrices: createApiFixture<TraceAppDependencies["braidPrices"]>({}, "braidPrices"),
  };
}

/**
 * A real `TraceModule` over doubles for everything a test does not configure: each unconfigured
 * member throws by name when called, so a test states exactly the readers it drives.
 */
export function createTraceAppHarness({
  traces = {},
  ...dependencies
}: Partial<Omit<TraceAppDependencies, "traces">> & {
  traces?: Partial<TraceReaders>;
} = {}): TraceModule {
  return TraceModule.fromDependencies({
    storedObjects: createApiFixture<TraceAppDependencies["storedObjects"]>({}, "storedObjects"),
    broadcast: createApiFixture<TraceAppDependencies["broadcast"]>({}, "broadcast"),
    spanCostSuggestions: createApiFixture<TraceAppDependencies["spanCostSuggestions"]>(
      {},
      "spanCostSuggestions",
    ),
    evaluationRuns: createApiFixture<TraceAppDependencies["evaluationRuns"]>({}, "evaluationRuns"),
    share: createApiFixture<TraceAppDependencies["share"]>({}, "share"),
    projects: createApiFixture<TraceAppDependencies["projects"]>({}, "projects"),
    requestBounds: createApiFixture<TraceAppDependencies["requestBounds"]>({}, "requestBounds"),
    exportBounds: null,
    ...braidTwins(),
    ...dependencies,
    traces: createApiFixture<TraceReaders>(
      { braidReads: MemoryNullTraceBraidReadsRepository.create(), ...traces },
      "traces",
    ),
  });
}
