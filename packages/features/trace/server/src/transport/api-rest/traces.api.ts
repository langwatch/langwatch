/**
 * REST for the v1 trace reads: search, get-by-id, transcript, metadata PATCH. Everything the
 * routes reach through the process is a port; the projection compiler, evaluation enricher and
 * formatters are this package's own. The search body's additive half (projection DSL, output
 * format, date axis) is published as {@link traceSearchBodyExtensions}. Each route group lives
 * in its own module beside this one; the factory names them in registration order.
 */
import {
  type AppRestSecurity,
  type MountableRestApp,
  type PlatformUrlBuilder,
  type RestCredentialPrincipal,
} from "@langwatch/api/rest";
import type { Evaluation, Trace, TracesForProjectResult } from "@langwatch/trace-contract";
import { z } from "zod";

import {
  type CompiledProjection,
  type ProjectionRequest,
  projectionRequestSchema,
} from "@langwatch/trace-contract";
import type { TraceDateField } from "@langwatch/trace-contract";
import type { TraceMetadataUpdate } from "#services/trace-metadata-write.service";

import { registerTracesSearchRoute } from "./traces-search.api.ts";
import {
  registerTraceMetadataRoute,
  registerTraceReadRoute,
  registerTraceTranscriptRoute,
} from "./traces-detail.api.ts";

/**
 * The additive half of the search body; the other half is the deployment's shared analytics
 * filter vocabulary, arriving as {@link TracesRestPorts}' `searchBodySchema`. A mount merges
 * the two. The describe() text here is the public API documentation for these fields.
 */
export const traceSearchBodyExtensions = {
  scrollId: z.string().optional().nullable(),
  format: z
    .enum(["digest", "json"])
    .optional()
    .describe("Output format: 'digest' (AI-readable trace digest) or 'json' (full raw data)"),
  includeSpans: z
    .boolean()
    .optional()
    .describe(
      "When true, fetches full span data for each trace. Useful for bulk export. Default false.",
    ),
  llmMode: z.boolean().optional(),
  dateField: z
    .enum(["occurred", "updated"])
    .default("occurred")
    .describe(
      "Which timestamp the startDate/endDate window filters on. 'occurred' (default) " +
        "selects traces by when they happened. 'updated' selects traces by when they were " +
        "last modified — use this for incremental ETL ('give me everything changed since my " +
        "last pull'), since a trace can occur long before it gains a later evaluation or " +
        "annotation.",
    ),
  ...projectionRequestSchema.shape,
} as const;

/**
 * What a caller may send to `POST /search`. Everything beyond the named fields is the
 * deployment's filter vocabulary and travels to the read untouched.
 */
export type TraceSearchBody = ProjectionRequest &
  Readonly<{
    startDate: string | number;
    endDate: string | number;
    pageSize?: number | undefined;
    scrollId?: string | null | undefined;
    format?: "digest" | "json" | undefined;
    includeSpans?: boolean | undefined;
    llmMode?: boolean | undefined;
    dateField: TraceDateField;
  }>;

/**
 * The legacy trace read, as the three read routes here use it. Declared narrowly rather than as
 * the whole `TraceLegacyReadPort`, so this surface can't answer a question it doesn't publish.
 */
export interface TracesRestReadPort {
  getAllTracesForProject(
    input: Readonly<{ projectId: string }> & Record<string, unknown>,
    protections: unknown,
    options: Readonly<{
      downloadMode?: boolean;
      includeSpans?: boolean;
      scrollId?: string | undefined;
      dateField?: TraceDateField;
      projection?: CompiledProjection["plan"];
    }>,
  ): Promise<TracesForProjectResult>;
  tryGetById(
    projectId: string,
    traceId: string,
    protections: unknown,
    opts?: Readonly<{ full?: boolean }>,
  ): Promise<Trace | undefined>;
  getEvaluationsMultiple(
    projectId: string,
    traceIds: string[],
    protections: unknown,
  ): Promise<Record<string, Evaluation[]>>;
}

/** What the v1 trace family needs from the process. */
export interface TracesRestPorts<TBody extends TraceSearchBody, TBodyRaw> {
  /**
   * The deployment's shared analytics filter vocabulary merged with {@link
   * traceSearchBodyExtensions}. Both the parsed and sent shapes are carried since they differ —
   * `dateField` and `from` both carry defaults — and the validator types the 400 body off the
   * sent shape.
   */
  searchBodySchema: z.ZodType<TBody, TBodyRaw>;
  /** The read itself. Resolved per request, never constructed at mount. */
  traces(): TracesRestReadPort;
  /**
   * The API key caller's read-time redactions for one project. A key is not a person, so
   * categories resolve as for a caller with no session; costs are the CREDENTIAL's own
   * question, which is why the principal travels with the project rather than the answer
   * being assumed for every key.
   */
  getProtections(
    input: Readonly<{ projectId: string; credential: RestCredentialPrincipal }>,
  ): Promise<unknown>;
  /** Deep links back into the product, built from the deployment's origin. */
  platformUrl: PlatformUrlBuilder;
  /**
   * The reserved-metadata amendment, or none where the process registered no command queue — a
   * PATCH answering 200 while recording nothing is a change the caller can't tell didn't happen,
   * so absent, the route is not registered at all.
   */
  updateTraceMetadata?:
    | ((
        input: Readonly<{
          projectId: string;
          traceId: string;
          metadata: TraceMetadataUpdate;
        }>,
      ) => Promise<void>)
    | undefined;
  /**
   * The coding-agent transcript join, or none where the process composed no coding-agent
   * session store — an empty transcript would misread as "this agent did nothing" rather than
   * "this deployment cannot tell you", so absent, the route is not registered at all.
   */
  readCodingAgentTranscript?:
    | ((
        input: Readonly<{
          projectId: string;
          traceId: string;
          occurredAtMs: number;
          protections: unknown;
        }>,
      ) => Promise<unknown>)
    | undefined;
}

/**
 * ORDERING inside the family is load-bearing: `/:traceId/transcript` and `/:traceId/metadata`
 * register before the bare `/:traceId`, so the literal sub-resources aren't swallowed by it.
 */
export function createTracesRestApp<TBody extends TraceSearchBody, TBodyRaw>(options: {
  security: AppRestSecurity;
  ports: TracesRestPorts<TBody, TBodyRaw>;
}): MountableRestApp {
  const { security, ports } = options;

  const family = security.createProjectVersionedApp({
    name: "traces",
    basePath: "/api/traces",
    errorEnvelope: "legacy",
  });

  registerTracesSearchRoute(family, ports);
  if (ports.readCodingAgentTranscript) registerTraceTranscriptRoute(family, ports);
  if (ports.updateTraceMetadata) registerTraceMetadataRoute(family, ports);
  // LAST of the three, so the two literal sub-resources above are not swallowed by the parameter.
  registerTraceReadRoute(family, ports);

  return family.service.build();
}
