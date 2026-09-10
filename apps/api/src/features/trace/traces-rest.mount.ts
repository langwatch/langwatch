/**
 * Binds the v1 trace REST declaration (`@langwatch/trace-server`'s
 * `createTracesRest`) to this process's project door: the deployment's own
 * filter vocabulary, the deployment origin, and the API-key-aware
 * protections `ApiTraceReadStack` already resolves.
 */
import { bindRestMiddleware, flexibleDateSchema, type PlatformUrlBuilder } from "@langwatch/api/rest";
import type { TraceApp } from "@langwatch/trace-server";
import { createTracesRest, tracesRestCredential } from "@langwatch/trace-server/api-rest/traces";

import { API_TRACE_LIST_INPUT } from "../../app/api-trace-read-stack.composition.ts";
import type { ApiTraceReadStack } from "./trace-read-stack.port.ts";
import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/**
 * The v1 search body: the deployment's filter vocabulary, minus the three
 * fields this door takes from elsewhere, plus the family's own additive half.
 */
const traceSearchBodySchema = API_TRACE_LIST_INPUT.omit({
  projectId: true,
  startDate: true,
  endDate: true,
}).extend({
  startDate: flexibleDateSchema,
  endDate: flexibleDateSchema,
});

/** What this process supplies the v1 family. */
export type ApiTracesRestOptions = Readonly<{
  /** The one application this process composed the module from. */
  traces: () => TraceApp;
  /** The read stack the browser's own trace surfaces answer from. */
  reads: ApiTraceReadStack;
  /** Deep links back into the product, built from the deployment's origin. */
  platformUrl: PlatformUrlBuilder;
  /**
   * The reserved-metadata amendment, or none. Absent where this process
   * registered no command queue, and then `PATCH /:traceId/metadata` is not
   * registered at all rather than answering 200 to a write it dropped.
   */
  updateTraceMetadata?:
    | ((input: { projectId: string; traceId: string; metadata: Record<string, unknown> }) => Promise<void>)
    | undefined;
}>;

/** `/api/traces` and `/api/v1/traces`, bound to this process's project door. */
export function mountTracesRest(runtime: ApiRestRuntime, options: ApiTracesRestOptions) {
  const { traces, reads, platformUrl, updateTraceMetadata } = options;

  const declaration = createTracesRest({
    searchBodySchema: traceSearchBodySchema,
    platformUrl,
    getProtections: ({ projectId, caller }) =>
      reads.getApiKeyProtections({
        projectId,
        credential: caller.apiKeyId
          ? {
              kind: "apiKey",
              apiKeyId: caller.apiKeyId,
              userId: caller.userId,
              organizationId: "",
              projectId,
              teamId: "",
            }
          : { kind: "legacyProjectKey" },
      }),
    ...(updateTraceMetadata
      ? {
          updateTraceMetadata: (input: { projectId: string; traceId: string; metadata: unknown }) =>
            updateTraceMetadata({
              projectId: input.projectId,
              traceId: input.traceId,
              metadata: input.metadata as Record<string, unknown>,
            }),
        }
      : {}),
    // Named absence: the coding-agent transcript join is not supplied because
    // `composeApiTraceReadStack` refuses `LogService.getLogsByTraceId` by
    // name, and deriving a transcript without it would answer an empty one
    // for every trace. Not a missing session store — the transcript never
    // reads a session.
  });

  return runtime.mount(declaration.router(), traces, {
    facts: [
      bindRestMiddleware(tracesRestCredential, (context) => {
        const credential = runtime.projectCredentialOf(context.req.raw);
        return {
          apiKeyId: credential.type === "apiKey" ? credential.apiKeyId : null,
          userId: credential.type === "apiKey" ? credential.userId : null,
        };
      }),
    ],
  });
}
