/**
 * The REST collector: `POST /api/collector`.
 *
 * Was `platform/app/src/server/routes/collector.ts`. This is the SDK's own
 * ingest door — the one an SDK posts a whole trace to in one body, spans and
 * custom evaluations together — and it sits beside the OTLP receiver on the
 * same producer registration, the same Redis dedup gate and the same
 * handler-managed credential, so a span that arrives here and a span that
 * arrives on `/api/otel/v1/traces` are recorded by one path.
 *
 * Everything the platform route reached through its global application
 * container is a port now: the credential, the plan allowance, the span
 * ingestion, the evaluation report and the evaluator-id slug rule. The two
 * ingest rules it used to import from a browser module — the RAG context
 * id/normalisation pass and the chunk text extractor — are
 * `@langwatch/trace-contract`'s, where both halves can name them.
 *
 * The nine distinct 400 sentences, the two 429s, the 402 and the 500 are
 * transcribed rather than rewritten: every one of them is what a deployed SDK
 * shows a customer.
 */
import crypto from "node:crypto";

import { bodyLimit, type AppRestSecurity, type SecuredApp } from "@langwatch/api/rest";
import { handlerManagedAuth } from "@langwatch/api";
import { createLogger, validationMeta } from "@langwatch/observability";
import type { Env } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";

import {
  collectorRESTParamsValidatorSchema,
  customMetadataSchema,
  DEFAULT_PII_REDACTION_LEVEL,
  langWatchSpanSchema,
  maybeAddIdsToContextList,
  reservedTraceMetadataSchema,
  spanMetricsSchema,
  spanValidatorSchema,
  SPAN_MAX_PAST_MS,
  type CollectorRESTParamsValidator,
  type CustomMetadata,
  type ReservedTraceMetadata,
  type Span,
} from "@langwatch/trace-contract";

import { CollectorSpanUtils } from "#services/trace-collector-span.service";

const logger = createLogger("langwatch.collector");

/** The project a collector body is recorded against. */
export type CollectorProject = Readonly<{
  id: string;
  teamId: string;
  organizationId: string;
}>;

/**
 * A resolved credential, or why it was refused.
 *
 * The two refusals are told apart rather than passed through as one body,
 * because their copy comes from two different places. `credential` is THIS
 * family's own sentence — `{error:"Unauthorized", message:"Invalid
 * credentials"}`, which every LangWatch SDK's error copy quotes — and it
 * covers both a missing token and one that resolves to nothing. `ceiling` is
 * the AuthZ layer's full handled payload (code, permission, tips), which the
 * family forwards untouched because a caller acts on its fields.
 */
export type CollectorCredential =
  | Readonly<{ ok: true; project: CollectorProject; markUsed: () => void }>
  | Readonly<{ ok: false; kind: "credential" }>
  | Readonly<{ ok: false; kind: "ceiling"; status: ContentfulStatusCode; body: object }>;

/** How this process turns a request into a project credential. */
export type CollectorCredentialPort = (input: {
  request: Request;
}) => Promise<CollectorCredential>;

/**
 * The plan allowance, enforced before the body is reshaped.
 *
 * It THROWS to refuse — the refusal is a `HandledError` the process's error
 * boundary renders as a 402, deliberately not a 429: OTel SDKs and most HTTP
 * clients retry a 429, and a plan limit is terminal for that payload, so a
 * retryable status turns one rejection into an unbounded loop. It returns for
 * every other outcome INCLUDING a lookup that failed, which is the behaviour
 * this path has always had.
 */
export type CollectorUsageLimitPort = (input: {
  project: CollectorProject;
}) => Promise<void>;

/** One already-normalized span, handed to the ingestion pipeline. */
export type CollectorSpanIngestPort = (input: {
  tenantId: string;
  span: ReturnType<typeof CollectorSpanUtils.convertSpanToOtlp>;
  resource: ReturnType<typeof CollectorSpanUtils.buildResource>;
  instrumentationScope: Readonly<{ name: string }>;
  piiRedactionLevel: typeof DEFAULT_PII_REDACTION_LEVEL;
}) => Promise<Readonly<{ status: string; error?: string | undefined }>>;

/** One custom SDK evaluation, reported to the evaluation pipeline. */
export type CollectorEvaluationReportPort = (input: {
  tenantId: string;
  evaluationId: string;
  evaluatorId: string;
  evaluatorType: string;
  evaluatorName: string;
  traceId: string;
  isGuardrail?: boolean | undefined;
  status: string;
  score: number | null;
  passed: boolean | null;
  label: string | null;
  details: string | null;
  error: string | null;
  occurredAt: number;
}) => Promise<unknown>;

/** Reports a failure the collector answered but did not raise. */
export type CollectorErrorReportPort = (
  error: Error,
  context: Readonly<{ projectId: string; traceId?: string | undefined }>,
) => void;

export type CollectorRestPorts = Readonly<{
  credential: CollectorCredentialPort;
  /**
   * The plan allowance, or none.
   *
   * None where the process composed no usage meter, and then no monthly
   * allowance is enforced. That is the same degradation this path has always
   * had when the allowance LOOKUP failed — the batch is accepted — because
   * telemetry a customer already paid to produce must not be dropped by a
   * meter this process cannot read.
   */
  usageLimit?: CollectorUsageLimitPort | undefined;
  /** Where a normalized span goes. Required: it is the whole of this door. */
  ingestSpan: CollectorSpanIngestPort;
  /**
   * Where a custom SDK evaluation goes, or none.
   *
   * None where the process registered no evaluation pipeline. The spans still
   * land; each evaluation is counted in `partialSuccess.rejectedEvaluations`
   * with a sentence saying so, rather than dropped silently — a verdict a
   * customer believes they recorded is worse than one they are told was not.
   */
  reportEvaluation?: CollectorEvaluationReportPort | undefined;
  /**
   * The evaluator-id slug rule, for an evaluation that names no evaluator.
   *
   * A port because the rule is EVALUATION's — the same one its own
   * `custom-evaluation-sync` subscriber applies — and a feature server package
   * may not reach into another feature's server package. Two copies would
   * derive two ids for one evaluation name, and the id IS the key.
   */
  deriveEvaluatorId: (name: string) => string;
  reportError?: CollectorErrorReportPort | undefined;
}>;

/** The largest body this door reads before refusing it unread. */
const COLLECTOR_MAX_BODY_BYTES = 10 * 1024 * 1024;

/**
 * The REST collector, built against one process's security.
 *
 * `/api/collector` is a literal path nothing else claims, but it MUST be
 * registered before the OTLP path-alias re-dispatcher, which claims
 * `/api/collector/*` with a wildcard.
 */
export function createCollectorRestApp(options: {
  security: AppRestSecurity;
  ports: CollectorRestPorts;
}): SecuredApp<Env> {
  const { security, ports } = options;
  const secured = security.createServiceApp({ basePath: "/api" });

  secured
    .access(
      handlerManagedAuth({
        reason: "ingestion API key resolved in-handler",
        // Declared because this is the route it took a colleague "ages" to work
        // out from the code: trace collection is gated by `traces:create`, which
        // was previously discoverable only by reading the handler.
        permissions: ["traces:create"],
        credential: "apiKey",
      }),
    )
    .post("/collector", bodyLimit({ maxSize: COLLECTOR_MAX_BODY_BYTES }), async (c) => {
      const auth = await ports.credential({ request: c.req.raw });
      if (!auth.ok) {
        if (auth.kind === "ceiling") {
          logger.warn("collector request denied by API key ceiling");
          // The full handled body — code, permission, tips — not just a sentence.
          return c.json(auth.body, auth.status);
        }
        logger.warn("collector request is not authenticated");
        return c.json({ error: "Unauthorized", message: "Invalid credentials" }, 401);
      }

      // warn, not error: a malformed body is the caller's mistake and we answer
      // it with a 400. These three sites return rather than throw, so they never
      // reach the boundary that would classify them as customer fault, and at
      // error level they were about a fifth of this service's error stream.
      const contentType = c.req.header("content-type");
      if (!contentType?.includes("application/json")) {
        logger.warn("collector request body is not json");

        return c.json({ message: "Invalid body, expecting json" }, 400);
      }

      let body: Record<string, any>;
      try {
        body = await c.req.json();
      } catch {
        logger.warn("collector request body is not valid json");
        return c.json({ message: "Invalid body, expecting json" }, 400);
      }

      // `typeof null` is "object" and an array is one too, so both walk past a
      // bare typeof check and reach `"metadata" in body` below — which throws on
      // null. That is the same customer mistake as the two guards above, so it
      // belongs on the same 400 rather than in the error stream as a 500.
      if (body === null || Array.isArray(body) || typeof body !== "object") {
        logger.warn("collector request body is not a json object");
        return c.json({ message: "Invalid body, expecting json" }, 400);
      }

      const project = auth.project;

      logger.info({ projectId: project.id }, "collector request being processed");

      // The allowance refuses by throwing; every other outcome — including a
      // lookup that failed inside the port — lets the batch through.
      await ports.usageLimit?.({ project });

      // We migrated those keys to inside metadata, but we still want to support them for retrocompatibility for a while
      if (!("metadata" in body) || !body.metadata) {
        body.metadata = {};
        if ("thread_id" in body) {
          body.metadata.thread_id = body.thread_id;
        }
        if ("user_id" in body) {
          body.metadata.user_id = body.user_id;
        }
        if ("customer_id" in body) {
          body.metadata.customer_id = body.customer_id;
        }
        if ("labels" in body && body.labels) {
          body.metadata.labels = body.labels;
        }
      }

      // Allow objects and simple strings to be sent as labels as well
      if (body.metadata?.labels) {
        body.metadata.labels =
          typeof body.metadata.labels === "string"
            ? [body.metadata.labels]
            : Array.isArray(body.metadata.labels)
              ? body.metadata.labels
              : Object.entries(body.metadata.labels).map(
                  ([key, value]) => `${key}: ${value as string}`,
                );
      }

      for (const evaluation of body.evaluations ?? []) {
        if (
          evaluation.status !== "error" &&
          evaluation.status !== "skipped" &&
          (evaluation.passed === undefined || evaluation.passed === null) &&
          (evaluation.score === undefined || evaluation.score === null) &&
          (evaluation.label === undefined || evaluation.label === null)
        ) {
          logger.error(
            { projectId: project.id, evaluationId: evaluation.id },
            "evaluation has no passed, score or label",
          );

          return c.json(
            {
              error:
                "Either `passed`, `score` or `label` field must be defined for evaluations",
            },
            400,
          );
        }

        if (evaluation.error) {
          evaluation.error.has_error = true;
        }

        if (
          (evaluation.timestamps?.started_at &&
            evaluation.timestamps.started_at.toString().length !== 13) ||
          (evaluation.timestamps?.finished_at &&
            evaluation.timestamps.finished_at.toString().length !== 13)
        ) {
          logger.error(
            { projectId: project.id, evaluationId: evaluation.id },
            "evaluation timestamps not in milliseconds",
          );

          return c.json(
            {
              error:
                "Evaluation timestamps should be in milliseconds not in seconds, please multiply it by 1000",
            },
            400,
          );
        }
      }

      let params: CollectorRESTParamsValidator;
      try {
        params = collectorRESTParamsValidatorSchema.parse(body);
      } catch (error) {
        const validation = validationMeta(error);

        ports.reportError?.(new Error("ZodError on parsing body"), {
          projectId: project.id,
        });

        const validationError = fromZodError(error as ZodError);

        // Shape, never the body. The rendered `validationError.message` quotes
        // the offending values, so it answers the sender and stays out of the
        // log; `validation` is the schema's own vocabulary and is what tells us
        // whether the rule, rather than the payload, is the thing that is wrong.
        logger.warn({ projectId: project.id, ...validation }, "invalid trace received");

        return c.json({ error: validationError.message }, 400);
      }

      // Body successfully validated — mark the API key as used if this request was
      // authenticated via API key
      auth.markUsed();

      const { trace_id: nullableTraceId, expected_output: expectedOutput } = params;

      if (body.spans && !Array.isArray(body.spans)) {
        // The type, not the value: whatever arrived in place of the array is
        // still the sender's content, and the type is the whole diagnosis.
        logger.warn(
          {
            projectId: project.id,
            receivedType: typeof body.spans,
            traceId: nullableTraceId,
          },
          "invalid spans field, expecting array",
        );

        return c.json({ message: "Invalid 'spans' field, expecting array" }, 400);
      }

      if (body.spans?.length > 200) {
        logger.info(
          {
            projectId: project.id,
            spansCount: body.spans?.length,
            traceId: nullableTraceId,
          },
          "[429] Too many spans",
        );
        return c.json(
          {
            message: "Too many spans, maximum of 200 per trace",
          },
          429,
        );
      }

      // Mirror the span cap for evaluations: without it, a 10MB body of minimal
      // evaluation objects yields tens of thousands of sequential event-sourcing
      // dispatches per request (evaluations have no dedup gate, unlike spans).
      if ((params.evaluations?.length ?? 0) > 200) {
        logger.info(
          {
            projectId: project.id,
            evaluationsCount: params.evaluations?.length,
            traceId: nullableTraceId,
          },
          "[429] Too many evaluations",
        );
        return c.json(
          {
            message: "Too many evaluations, maximum of 200 per trace",
          },
          429,
        );
      }

      let reservedTraceMetadata: ReservedTraceMetadata = {};
      let customMetadata: CustomMetadata = {};
      try {
        if (params.metadata) {
          reservedTraceMetadata = Object.fromEntries(
            Object.entries(reservedTraceMetadataSchema.parse(params.metadata)).filter(
              ([_key, value]) => value !== null && value !== undefined,
            ),
          );
          const remainingMetadata = Object.fromEntries(
            Object.entries(params.metadata).filter(
              ([key]) => !(key in reservedTraceMetadataSchema.shape),
            ),
          );
          customMetadata = customMetadataSchema.parse(remainingMetadata);
        }
      } catch (error) {
        const validationError = fromZodError(error as ZodError);
        const validation = validationMeta(error);

        ports.reportError?.(new Error("ZodError on parsing metadata"), {
          projectId: project.id,
        });

        // Metadata is customer-authored key/value content, so the values stay
        // out. The rejected KEY names do not: a key refused across many
        // projects is how we learn our reserved-metadata list is too narrow.
        logger.warn(
          { projectId: project.id, ...validation },
          "invalid metadata received",
        );

        return c.json({ error: validationError.message }, 400);
      }

      const spanFields = langWatchSpanSchema.options.flatMap((option) =>
        Object.keys(option.shape),
      );
      const spans = ((body as Record<string, any>).spans ?? []) as Span[];
      spans.forEach((span) => {
        // We changed "id" to "span_id", but we still want to support "id" for retrocompatibility for a while
        if ("id" in span) {
          span.span_id = span.id as string;
        }
        if (nullableTraceId && !span.trace_id) {
          span.trace_id = nullableTraceId;
        }
        // We changes "outputs" list to "output" single item, so here we keep supporting the old "outputs" for retrocompaibility
        if (
          typeof span.output === "undefined" &&
          "outputs" in span &&
          typeof span.outputs !== "undefined"
        ) {
          //@ts-expect-error
          if (span.outputs.length == 0) {
            span.output = null;
            //@ts-expect-error
          } else if (span.outputs.length == 1) {
            //@ts-expect-error
            span.output = span.outputs[0];
            //@ts-expect-error
          } else if (span.outputs.length > 1) {
            span.output = {
              type: "list",
              //@ts-expect-error
              value: span.outputs,
            };
          }
        }
        if ("contexts" in span) {
          // Keep retrocompatibility of RAG as a simple string list
          span.contexts = maybeAddIdsToContextList(span.contexts);
          // Allow number ids
          span.contexts = span.contexts.map((context) => ({
            ...context,
            ...(typeof context.document_id === "number"
              ? { document_id: `${context.document_id as number}` }
              : {}),
            ...(typeof context.chunk_id === "number"
              ? { chunk_id: `${context.chunk_id as number}` }
              : {}),
            content:
              typeof context.content === "string"
                ? context.content
                : JSON.stringify(context.content),
          }));
        }
        if (span.error) {
          span.error.has_error = true;
        }

        for (const key of Object.keys(span)) {
          if (!spanFields.includes(key)) {
            delete (span as any)[key];
          }
        }
      });

      const traceId = nullableTraceId ?? spans[0]?.trace_id;
      if (!traceId) {
        logger.error(
          {
            projectId: project.id,
            traceId: nullableTraceId,
            spanCount: spans.length,
            spanIds: spans.map((span) => span.span_id),
          },
          "trace id not defined",
        );

        return c.json({ message: "Trace ID not defined" }, 400);
      }

      const traceIds = Array.from(
        new Set(spans.filter((span) => span.trace_id).map((span) => span.trace_id)),
      );
      if (traceIds[0] && (traceIds.length > 1 || traceIds[0] != traceId)) {
        logger.error(
          { projectId: project.id, traceId, traceIds },
          "trace ids are not the same",
        );

        return c.json({ message: "All spans must have the same trace id" }, 400);
      }

      for (const [index, span] of spans.entries()) {
        // Move extrataneous metrics to params for retrocompatibility
        if (span.metrics) {
          const validMetrics = spanMetricsSchema.safeParse(span.metrics);
          if (validMetrics.success) {
            const extrataneousMetrics = Object.fromEntries(
              Object.entries(span.metrics).filter(([key]) => !(key in validMetrics.data)),
            );
            span.params = {
              ...span.params,
              ...extrataneousMetrics,
            };
            span.metrics = validMetrics.data;
          }
        }
        try {
          spans[index] = spanValidatorSchema.parse(span);
        } catch (error) {
          const validation = validationMeta(error);

          ports.reportError?.(new Error("ZodError on parsing spans"), {
            projectId: project.id,
            traceId,
          });

          const validationError = fromZodError(error as ZodError);

          logger.warn(
            { projectId: project.id, index, ...validation },
            "invalid span received",
          );

          return c.json(
            {
              error: validationError.message + ` at "spans[${index}]"`,
            },
            400,
          );
        }

        if (
          (span.timestamps.started_at &&
            span.timestamps.started_at.toString().length !== 13) ||
          (span.timestamps.finished_at &&
            span.timestamps.finished_at.toString().length !== 13) ||
          (span.timestamps.first_token_at &&
            span.timestamps.first_token_at.toString().length !== 13)
        ) {
          logger.error(
            { traceId, projectId: project.id },
            "timestamps not in milliseconds for span",
          );
          return c.json(
            {
              error:
                "Timestamps should be in milliseconds not in seconds, please multiply it by 1000",
            },
            400,
          );
        }
      }

      // OTLP parity: processSpan drops spans older than SPAN_MAX_PAST_MS before
      // the dedup gate, so apply the same age cutoff here — otherwise the REST
      // path alone would write arbitrarily old timestamps into cold ClickHouse
      // partitions, undermining partition pruning.
      const startedAtCutoff = Date.now() - SPAN_MAX_PAST_MS;
      const freshSpans: Span[] = [];
      let droppedOldSpans = 0;
      for (const span of spans) {
        if (span.timestamps.started_at && span.timestamps.started_at < startedAtCutoff) {
          droppedOldSpans++;
          continue;
        }
        freshSpans.push(span);
      }
      if (droppedOldSpans > 0) {
        logger.info(
          { projectId: project.id, traceId, droppedOldSpans },
          "dropped spans with start time more than 31 days in the past",
        );
      }

      let rejectedSpans = droppedOldSpans;
      let dispatchFailures = 0;
      let rejectionErrors: string[] =
        droppedOldSpans > 0
          ? [
              `${droppedOldSpans} span(s) dropped: start time is more than 31 days in the past`,
            ]
          : [];
      try {
        const resource = CollectorSpanUtils.buildResource({
          reservedTraceMetadata,
          customMetadata,
          expectedOutput,
        });

        const results = await Promise.allSettled(
          freshSpans.map((span) =>
            // Route through the ingestion pipeline (not the command sender
            // directly) so the REST collector shares the (tenant, trace, span)
            // dedup gate + ADR-022 spool hook with the OTLP path — a retry storm
            // here must not bypass dedup. occurredAt is stamped inside it.
            ports.ingestSpan({
              tenantId: project.id,
              span: CollectorSpanUtils.convertSpanToOtlp(span),
              resource,
              instrumentationScope: { name: "langwatch.rest.collector" },
              piiRedactionLevel: DEFAULT_PII_REDACTION_LEVEL,
            }),
          ),
        );

        // `ingestNormalizedSpan` catches its own errors and RESOLVES with
        // `{ status: "failed", error }` (it never rejects), so inspect the
        // resolved status — checking the allSettled "rejected" wrapper would
        // count every failure as a success. An unexpected rejection is still
        // treated as a failure defensively. "deduped" is a success, not an error.
        const failureErrors = results
          .map((r) => {
            if (r.status === "rejected") {
              return r.reason instanceof Error ? r.reason.message : String(r.reason);
            }
            return r.value.status === "failed"
              ? (r.value.error ?? "span ingestion failed")
              : null;
          })
          .filter((e): e is string => e !== null);
        dispatchFailures = failureErrors.length;
        rejectedSpans += failureErrors.length;
        rejectionErrors = [...rejectionErrors, ...failureErrors];
        if (failureErrors.length > 0) {
          logger.error(
            {
              projectId: project.id,
              traceId,
              failureCount: failureErrors.length,
              errors: failureErrors,
            },
            "Error dispatching collector spans to event sourcing",
          );
        }
      } catch (error) {
        // Catch synchronous errors (e.g., from buildResource)
        dispatchFailures = freshSpans.length;
        rejectedSpans += freshSpans.length;
        rejectionErrors.push(error instanceof Error ? error.message : String(error));
        logger.error(
          { error, projectId: project.id, traceId },
          "Error initializing event sourcing dispatch",
        );
      }

      // Total ingestion failure: every dispatched span failed (e.g. Redis /
      // group-queue outage). There is no fallback stack, so a 200 here
      // would tell the SDK the trace landed and it would never retry —
      // permanent trace loss. Return 500 so clients retry; the dedup gate
      // releases failed spans via releaseOnFailure, so a retry is safe.
      // Partial success stays 2xx for SDK back-compat.
      if (freshSpans.length > 0 && dispatchFailures === freshSpans.length) {
        return c.json(
          {
            message: `Failed to ingest all ${dispatchFailures} spans, please retry`,
            partialSuccess: {
              rejectedSpans,
              errorMessage: rejectionErrors.join("; "),
            },
          },
          500,
        );
      }

      // Dispatch custom SDK evaluations to the event-sourcing evaluation pipeline.
      // The REST collector receives evaluations as a separate field (not as span events),
      // so they must be dispatched independently from the spans above.
      let rejectedEvaluations = 0;
      const evaluationErrors: string[] = [];
      if (params.evaluations && params.evaluations.length > 0 && traceId) {
        const reportEvaluation = ports.reportEvaluation;
        if (!reportEvaluation) {
          rejectedEvaluations = params.evaluations.length;
          evaluationErrors.push(
            "This deployment records no evaluations, so the evaluations on this trace were not stored.",
          );
          logger.warn(
            { projectId: project.id, traceId, count: params.evaluations.length },
            "no evaluation pipeline on this process; collector evaluations rejected by name",
          );
        } else {
          const occurredAt = Date.now();

          for (const evaluation of params.evaluations) {
            // try/catch per evaluation so one failing dispatch does not silently
            // drop the remaining evaluations; failures are surfaced to the client
            // via partialSuccess.rejectedEvaluations below.
            try {
              const evaluationMD5 = crypto
                .createHash("md5")
                .update(JSON.stringify({ traceId, evaluation }))
                .digest("hex");
              const evaluationId = evaluation.evaluation_id ?? `eval_md5_${evaluationMD5}`;
              const evaluatorId =
                evaluation.evaluator_id ?? ports.deriveEvaluatorId(evaluation.name);
              const status =
                evaluation.status ?? (evaluation.error ? "error" : "processed");
              // A verdict is only real when the evaluator ran to completion —
              // an errored/skipped run's stray passed/score/label must not
              // reach analytics or triggers as a real result (#6833). Same
              // gate as the shared verdictGate helpers applied at the
              // executeEvaluation command boundary.
              const hasVerdict = status === "processed";

              await reportEvaluation({
                tenantId: project.id,
                evaluationId,
                evaluatorId,
                evaluatorType: "custom",
                evaluatorName: evaluation.name,
                traceId,
                isGuardrail: evaluation.is_guardrail ?? undefined,
                status,
                score: hasVerdict ? (evaluation.score ?? null) : null,
                passed: hasVerdict ? (evaluation.passed ?? null) : null,
                label: hasVerdict ? (evaluation.label ?? null) : null,
                details: evaluation.details ?? null,
                error: evaluation.error?.message ?? null,
                occurredAt,
              });
            } catch (error) {
              rejectedEvaluations++;
              evaluationErrors.push(error instanceof Error ? error.message : String(error));
              logger.error(
                {
                  error,
                  projectId: project.id,
                  traceId,
                  evaluationName: evaluation.name,
                },
                "Error dispatching REST evaluation to event sourcing",
              );
            }
          }
        }
      }

      return c.json({
        message: "Trace received successfully.",
        partialSuccess: {
          rejectedSpans,
          rejectedEvaluations,
          errorMessage: [...rejectionErrors, ...evaluationErrors].join("; "),
        },
      });
    });

  return secured;
}

