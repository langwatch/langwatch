import { createApiFixture } from "@langwatch/test-harness/api-fixture";

import { TraceModule, type TraceAppDependencies } from "../../trace.app.ts";

type TraceReaders = TraceAppDependencies["traces"];

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
    topics: createApiFixture<TraceAppDependencies["topics"]>({}, "topics"),
    broadcast: createApiFixture<TraceAppDependencies["broadcast"]>({}, "broadcast"),
    evaluations: createApiFixture<TraceAppDependencies["evaluations"]>({}, "evaluations"),
    codingAgents: createApiFixture<TraceAppDependencies["codingAgents"]>({}, "codingAgents"),
    share: createApiFixture<TraceAppDependencies["share"]>({}, "share"),
    projects: createApiFixture<TraceAppDependencies["projects"]>({}, "projects"),
    requestBounds: createApiFixture<TraceAppDependencies["requestBounds"]>({}, "requestBounds"),
    exportBounds: null,
    ...dependencies,
    traces: createApiFixture<TraceReaders>(traces, "traces"),
  });
}
