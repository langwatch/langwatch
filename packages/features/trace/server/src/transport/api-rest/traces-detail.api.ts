/**
 * The three `/api/traces/:traceId` reads: the coding-agent transcript, the metadata amendment,
 * and the trace itself. Registered in that order — the two literal sub-resources must not be
 * swallowed by the bare parameter route.
 */
import { TraceReadableSpanService } from "#services/trace-readable-span.service";
import { TraceFormattingService } from "#services/trace-formatting.service";
import { requires } from "@langwatch/api";
import {
  baseResponses,
  credentialPrincipalOf,
  MANAGEMENT_API_VERSION,
  projectOf,
  resolver,
  type RestApiVersionedFamily,
} from "@langwatch/api/rest";
import type { Trace } from "@langwatch/trace-contract";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { AmbiguousTraceIdPrefixError } from "#services/trace-legacy-read.service";

import type { TraceSearchBody, TracesRestPorts } from "./traces.api";
import {
  ambiguousPrefixResponse,
  logger,
  TRACE_ANSWER_REASON,
  traceFormatQuerySchema,
  traceIdParamsSchema,
  traceMetadataBodySchema,
  traceMetadataResponseSchema,
  traceNotFoundResponse,
  transcriptResponseSchema,
  type TraceContext,
} from "./traces-shared.api";

export function registerTraceTranscriptRoute<TBody extends TraceSearchBody, TBodyRaw>(
  family: RestApiVersionedFamily,
  ports: TracesRestPorts<TBody, TBodyRaw>,
): void {
  const { service, policy } = family;

  // GET /:traceId/transcript - the coding-agent transcript for one trace.
  // Registered only where the process composed the join it reads; see the port.
  const readCodingAgentTranscript = ports.readCodingAgentTranscript;
  if (readCodingAgentTranscript) {
    const transcriptHandler = async (
      c: TraceContext,
      input: z.infer<typeof traceIdParamsSchema>,
    ) => {
      const project = projectOf(c);
      const { traceId } = input;

      logger.info({ projectId: project.id, traceId }, "Getting trace transcript");

      const protections = await ports.getProtections({
        projectId: project.id,
        credential: credentialPrincipalOf(c),
      });

      let trace: Trace | undefined;
      try {
        trace = await ports.traces().tryGetById(project.id, traceId, protections);
      } catch (err) {
        if (err instanceof AmbiguousTraceIdPrefixError) {
          return c.json(
            {
              message: err.message,
              candidateTraceIds: err.candidateTraceIds,
            },
            409,
          );
        }
        throw err;
      }

      if (!trace) {
        throw new HTTPException(404, {
          message: "Trace not found.",
        });
      }

      const transcript = await readCodingAgentTranscript({
        projectId: project.id,
        traceId: trace.trace_id,
        occurredAtMs: trace.timestamps.started_at,
        protections,
      });

      return c.json(transcript as Record<string, unknown>);
    };

    service.registerRoute(
      "get",
      "/:traceId/transcript",
      MANAGEMENT_API_VERSION,
      transcriptHandler,
      (b) =>
        policy(requires("traces:view"))(b)
          .withParams(traceIdParamsSchema)
          .withRawResponse(TRACE_ANSWER_REASON, { contentType: "application/json" })
          .withDocs({
            description:
              "Derived coding-agent transcript for a trace: what the agent did, in order, " +
              "with per-call token and cost economics. Empty entries for traces without " +
              "coding-agent content.",
            responses: {
              ...baseResponses,
              200: {
                description:
                  "The transcript: ordered entries plus per-session totals and sub-agent tool counts",
                content: {
                  "application/json": { schema: resolver(transcriptResponseSchema) },
                },
              },
              ...traceNotFoundResponse,
              ...ambiguousPrefixResponse,
            },
          }),
    );
  }
}

export function registerTraceMetadataRoute<TBody extends TraceSearchBody, TBodyRaw>(
  family: RestApiVersionedFamily,
  ports: TracesRestPorts<TBody, TBodyRaw>,
): void {
  const { service, policy } = family;

  // PATCH /:traceId/metadata - Update trace metadata via synthetic span.
  // Registered only where the process composed the ingestion the amendment
  // rides on; see the port.
  const updateTraceMetadata = ports.updateTraceMetadata;
  if (updateTraceMetadata) {
    const metadataHandler = async (
      c: TraceContext,
      input: z.infer<typeof traceIdParamsSchema> & z.infer<typeof traceMetadataBodySchema>,
    ) => {
      const project = projectOf(c);
      const { traceId } = input;

      await updateTraceMetadata({
        projectId: project.id,
        traceId,
        metadata: input.metadata,
      });

      return { traceId };
    };

    service.registerRoute(
      "patch",
      "/:traceId/metadata",
      MANAGEMENT_API_VERSION,
      metadataHandler,
      (b) =>
        policy(requires("traces:update"))(b)
          .withParams(traceIdParamsSchema)
          .withInput(traceMetadataBodySchema)
          .withOutput(traceMetadataResponseSchema)
          .withDocs({
            tags: ["Traces"],
            summary: "Update trace metadata",
            description:
              "Update metadata on a trace after creation. Inserts a synthetic span carrying the new attributes through the standard ingestion pipeline. New keys are added, existing keys are updated, missing keys are preserved. Labels replace entirely.",
            responses: {
              200: {
                description: "Metadata updated successfully",
                content: {
                  "application/json": { schema: resolver(traceMetadataResponseSchema) },
                },
              },
              ...baseResponses,
            },
          }),
    );
  }
}

export function registerTraceReadRoute<TBody extends TraceSearchBody, TBodyRaw>(
  family: RestApiVersionedFamily,
  ports: TracesRestPorts<TBody, TBodyRaw>,
): void {
  const { service, policy } = family;

  // GET /:traceId - Get a single trace by ID. LAST of the three, so the two
  // literal sub-resources above are not swallowed by the parameter.
  const traceHandler = async (
    c: TraceContext,
    input: z.infer<typeof traceIdParamsSchema> & z.infer<typeof traceFormatQuerySchema>,
  ) => {
    const project = projectOf(c);
    const { traceId } = input;
    const formatParam = input.format;
    const llmModeParam = input.llmMode;
    const format =
      formatParam ?? (llmModeParam === "true" || llmModeParam === "1" ? "digest" : "json");

    logger.info({ projectId: project.id, traceId }, "Getting trace by ID");

    const protections = await ports.getProtections({
      projectId: project.id,
      credential: credentialPrincipalOf(c),
    });
    const traceService = ports.traces();

    let trace: Trace | undefined;
    try {
      trace = await traceService.tryGetById(project.id, traceId, protections, {
        full: true,
      });
    } catch (err) {
      if (err instanceof AmbiguousTraceIdPrefixError) {
        return c.json(
          {
            message: err.message,
            candidateTraceIds: err.candidateTraceIds,
          },
          409,
        );
      }
      throw err;
    }

    if (!trace) {
      throw new HTTPException(404, {
        message: "Trace not found.",
      });
    }

    // If the caller passed a prefix, the resolved trace has the full ID.
    // Use that everywhere downstream so the response, links, and evaluation
    // lookup all key off the real trace ID.
    const resolvedTraceId = trace.trace_id;

    const evaluationsMap = await traceService.getEvaluationsMultiple(
      project.id,
      [resolvedTraceId],
      protections,
    );
    const evaluations = evaluationsMap[resolvedTraceId] ?? [];

    if (format === "digest") {
      return c.json({
        trace_id: resolvedTraceId,
        formatted_trace: await TraceReadableSpanService.formatSpansDigest(trace.spans ?? []),
        timestamps: trace.timestamps,
        metadata: trace.metadata,
        evaluations,
        platformUrl: ports.platformUrl({
          projectSlug: project.slug,
          path: `/traces/${resolvedTraceId}`,
        }),
      });
    }

    const asciiTree = TraceFormattingService.generateAsciiTree(trace.spans);
    return c.json({
      ...trace,
      evaluations,
      ascii_tree: asciiTree,
      platformUrl: ports.platformUrl({
        projectSlug: project.slug,
        path: `/traces/${resolvedTraceId}`,
      }),
    });
  };

  service.registerRoute("get", "/:traceId", MANAGEMENT_API_VERSION, traceHandler, (b) =>
    policy(requires("traces:view"))(b)
      .withParams(traceIdParamsSchema)
      .withQuery(traceFormatQuerySchema)
      .withRawResponse(TRACE_ANSWER_REASON, { contentType: "application/json" })
      .withDocs({
        description: "Get a single trace by ID.",
        responses: {
          ...baseResponses,
          200: {
            description: "Trace detail with spans, evaluations, and ASCII tree",
            content: {
              "application/json": { schema: resolver(z.object({}).passthrough()) },
            },
          },
          ...traceNotFoundResponse,
          ...ambiguousPrefixResponse,
        },
      }),
  );
}
