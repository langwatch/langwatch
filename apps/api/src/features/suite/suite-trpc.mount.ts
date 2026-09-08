/**
 * Binds the feature's declared procedures to this process's execution path.
 * Two declarations, one namespace: the browser has always called a test suite
 * at `suites.testSuites.*`, so the second is nested under the first.
 */
import type { TrpcRuntime } from "@langwatch/api/trpc";
import type { SuiteApi } from "@langwatch/suite-contract";
import { suiteTrpcTransport, testSuiteTrpcTransport } from "@langwatch/suite-server";

import type { ApiTrpcContext, ApiTrpcFeatureMount } from "../../api.application.ts";

/**
 * The one slice of the process context the `suites` namespace reads.
 *
 * `suites` is also the wire namespace the browser calls and the key tRPC
 * hashes into its query cache, so the two spellings are the same on purpose.
 */
export interface SuiteHostContext {
  app: Readonly<{ suites: SuiteApi }>;
}

/** Mounts `suites.*`, with `suites.testSuites.*` under it. */
export function createSuiteTrpcRouter(mount: ApiTrpcFeatureMount) {
  const runtime: TrpcRuntime<ApiTrpcContext> = mount.runtime;
  const suites = (ctx: SuiteHostContext): SuiteApi => ctx.app.suites;

  return mount.root.mergeRouters(
    runtime.mount(suiteTrpcTransport, suites),
    mount.root.router({ testSuites: runtime.mount(testSuiteTrpcTransport, suites) }),
  );
}
