/**
 * This process's composition of the three packaged trace REST families
 * (`@langwatch/trace-server`): the v1 reads, the deprecated `/api/trace/*`
 * endpoints and the SDK collector.
 *
 * Each route, its OpenAPI declaration and its behaviour live in the feature
 * package. What lives here is the binding, and every one of these bindings is
 * to a service this process ALREADY composed for its tRPC half:
 *
 *   - the v1 search and single-trace reads run on the trace-group's own read
 *     stack, which is the same stack `tracesV2.*` and `traces.*` answer from,
 *     so a REST caller and the explorer cannot see one trace redacted two
 *     ways;
 *   - the deprecated family runs on the SAME `TraceApp` and the SAME
 *     `ShareService` the browser's trace surfaces do, so a share link minted
 *     through the API and one minted in the product are one row;
 *   - the collector rides the SAME `trace_processing` producer registration
 *     the OTLP receiver does, through the same dedup gate.
 *
 * The search BODY is built here rather than in the package for the reason the
 * analytics timeseries body is: it is the deployment's shared analytics filter
 * vocabulary, which the trace feature does not own. `API_TRACE_LIST_INPUT` is
 * the one definition of it on this process — the same schema the legacy grid's
 * tRPC port carries — so the public search body and the browser's filter input
 * cannot drift.
 */
import {
  flexibleDateSchema,
  type AppRestSecurity,
  type MountableRestApp,
  type PlatformUrlBuilder,
} from "@langwatch/api/rest";
import type { ShareService } from "@langwatch/share-contract";
import type { TraceApp } from "@langwatch/trace-server";
import {
  createCollectorRestApp,
  createTraceLegacyRestApp,
  createTracesRestApp,
  traceSearchBodyExtensions,
  type CollectorRestPorts,
  type TraceLegacyCredentialPort,
  type TracesRestReadPort,
} from "@langwatch/trace-server";
import { fromZodError } from "zod-validation-error";
import { z } from "zod";

import { API_TRACE_LIST_INPUT } from "../../app/api-trace-read-stack.composition";
import type { ApiTraceReadStackPort } from "../../app/api-trpc-collaborators.trace-group.composition";
import type { ApiHandlerManagedCredentialPort } from "../../app-rest/app-rest.process-features";

/**
 * The v1 search body: the deployment's filter vocabulary, minus the three
 * fields this door takes from elsewhere, plus the family's own additive half.
 *
 * `projectId` comes from the credential; `startDate`/`endDate` are re-declared
 * by the family so an ISO string is accepted alongside epoch milliseconds,
 * which is what this endpoint has always accepted.
 */
const traceSearchBodySchema = API_TRACE_LIST_INPUT.omit({
  projectId: true,
  startDate: true,
  endDate: true,
}).extend({
  startDate: flexibleDateSchema,
  endDate: flexibleDateSchema,
  ...traceSearchBodyExtensions,
});

/**
 * The deprecated `/api/trace/search` body.
 *
 * The same vocabulary, parsed STRICTLY — that endpoint has always rejected an
 * unknown key rather than stripping it, and loosening it would silently accept
 * a typo a caller currently gets told about.
 */
const traceLegacySearchBodySchema = API_TRACE_LIST_INPUT.omit({
  projectId: true,
  startDate: true,
  endDate: true,
})
  .extend({
    startDate: z.union([
      z.number(),
      z.string().refine((val) => !Number.isNaN(Date.parse(val)), {
        message: "Invalid date format for startDate",
      }),
    ]),
    endDate: z.union([
      z.number(),
      z.string().refine((val) => !Number.isNaN(Date.parse(val)), {
        message: "Invalid date format for endDate",
      }),
    ]),
    scrollId: z.string().optional().nullable(),
    format: z.enum(["digest", "json"]).optional(),
    llmMode: z.boolean().optional().default(false),
  })
  .strict();

/** What this process supplies the v1 family. */
export type ApiTracesRestCollaborators = Readonly<{
  /** The read stack the browser's own trace surfaces answer from. */
  reads: ApiTraceReadStackPort;
  /** Deep links back into the product, built from the deployment's origin. */
  platformUrl: PlatformUrlBuilder;
  /**
   * The reserved-metadata amendment, or none. Absent where this process
   * registered no command queue, and then `PATCH /:traceId/metadata` is not
   * registered at all rather than answering 200 to a write it dropped.
   */
  updateTraceMetadata?:
    | ((input: {
        projectId: string;
        traceId: string;
        metadata: Record<string, unknown>;
      }) => Promise<void>)
    | undefined;
}>;

/** `/api/traces/*`, bound to one process's trace read stack. */
export function mountTracesRest(options: {
  security: AppRestSecurity;
  collaborators: ApiTracesRestCollaborators;
}): MountableRestApp {
  const { reads, platformUrl, updateTraceMetadata } = options.collaborators;
  return createTracesRestApp({
    security: options.security,
    ports: {
      searchBodySchema: traceSearchBodySchema,
      traces: () => reads.readers().read as unknown as TracesRestReadPort,
      getProtections: (input) => reads.getApiKeyProtections(input),
      platformUrl,
      ...(updateTraceMetadata
        ? {
            updateTraceMetadata: (input) =>
              updateTraceMetadata({
                projectId: input.projectId,
                traceId: input.traceId,
                metadata: input.metadata as Record<string, unknown>,
              }),
          }
        : {}),
      // The coding-agent transcript join is NOT supplied, and the ONE
      // collaborator missing is the CANONICAL LOG READ —
      // `LogService.getLogsByTraceId` over `log_records`, which
      // `composeApiTraceReadStack` refuses by name. Both legs of the join read
      // a trace's logs (the span enrichment and the transcript's own log
      // pass), and the legacy table left underneath has taken no write since
      // the canonical cutover, so the derivation would answer an empty
      // transcript — "this agent did nothing" — for every trace ingested
      // since. The route is left unregistered and answers 404 instead.
      //
      // NOT the coding-agent session store, which this process DOES compose
      // (the org group's `CodingAgentApp`, over its own ClickHouse). The
      // transcript never reads a session: it calls only the contract's own
      // pure derivation — `buildTranscript`, `logContentKeys`,
      // `contentAttrKeys` — so the store was never what this door was waiting
      // for.
    },
  }).hono as unknown as MountableRestApp;
}

/** What this process supplies the deprecated family. */
export type ApiTraceLegacyRestCollaborators = Readonly<{
  /** The one application the browser's trace surfaces read. */
  traces: () => TraceApp;
  /** The one share ledger a project's links live in. */
  shares: () => ShareService;
  /** The read stack, for the API key's redactions. */
  reads: ApiTraceReadStackPort;
  /** The process's one handler-managed credential resolution. */
  credential: ApiHandlerManagedCredentialPort;
}>;

/** `/api/trace/*` and `/api/thread/:id`, bound to this process's graph. */
export function mountTraceLegacyRest(options: {
  security: AppRestSecurity;
  collaborators: ApiTraceLegacyRestCollaborators;
}): MountableRestApp {
  const { traces, shares, reads, credential } = options.collaborators;
  const resolveCredential: TraceLegacyCredentialPort = (input) =>
    credential({ request: input.request, permission: input.permission });
  return createTraceLegacyRestApp({
    security: options.security,
    ports: {
      credential: resolveCredential,
      traces: () => traces(),
      shares: () => shares(),
      getProtections: (input) => reads.getApiKeyProtections(input),
      searchBodySchema: traceLegacySearchBodySchema,
      // The rendered sentence is what this endpoint has always answered with;
      // the endpoint predates the boundary's structured envelope and a
      // deployed client reads the prose.
      describeValidationError: (error) => fromZodError(error as never).message,
    },
  }).hono as unknown as MountableRestApp;
}

/** `POST /api/collector`, bound to this process's own ingestion. */
export function mountCollectorRest(options: {
  security: AppRestSecurity;
  ports: CollectorRestPorts;
}): MountableRestApp {
  return createCollectorRestApp({
    security: options.security,
    ports: options.ports,
  }).hono as unknown as MountableRestApp;
}
