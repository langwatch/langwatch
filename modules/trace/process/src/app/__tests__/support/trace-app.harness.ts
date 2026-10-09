import { ownProof } from "@langwatch/authorization/testing";
import type { AuthzApi } from "@langwatch/authz-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

import { TraceReadAuthorizationService } from "../../../services/trace-read-authorization.service.ts";
import { TraceModule, type TraceAppDependencies } from "../../trace.app.ts";

type TraceReaders = TraceAppDependencies["traces"];

/** The proofs a plain project's reads carry: authz mints its one own grant, nothing shared. */
export function ownProjectReadAuthorization(): TraceReadAuthorizationService {
  return TraceReadAuthorizationService.create({
    authz: createApiFixture<Pick<AuthzApi, "mintAuthorization" | "mintInternalAuthorization">>(
      {
        mintAuthorization: async ({ scope }) =>
          ownProof({ projectId: scope.projectId, now: Date.now() }),
        mintInternalAuthorization: async ({ projectId }) =>
          ownProof({ projectId, now: Date.now() }),
      },
      "authz",
    ),
    reads: createApiFixture({}, "authorized reads"),
  });
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
    readAuthorization: ownProjectReadAuthorization(),
    ...dependencies,
    traces: createApiFixture<TraceReaders>(traces, "traces"),
  });
}
