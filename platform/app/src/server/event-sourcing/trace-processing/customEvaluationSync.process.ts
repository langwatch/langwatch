import crypto from "node:crypto";
import type {
  EvolveStep,
  IntentDef,
  ProcessManagerHandlerMap,
} from "@langwatch/event-sourcing";
import { z } from "zod";
import type { traceEvents } from "./events";

export const CUSTOM_EVALUATION_SYNC_PROCESS_NAME =
  "customEvaluationSync" as const;

/** The OTLP span event an SDK writes for one evaluation it ran itself. */
export const CUSTOM_EVALUATION_SPAN_EVENT_NAME = "langwatch.evaluation.custom";
/** The span-event attribute carrying one evaluation as a JSON string. */
export const CUSTOM_EVALUATION_PAYLOAD_ATTRIBUTE = "json_encoded_event";

const STALE_TRACE_THRESHOLD_MS = 60 * 60 * 1000;

/** No state: a verdict is final on arrival, identified by the span that
 * carried it — there is nothing to accumulate across messages. */
export const customEvaluationSyncStateSchema = z.object({}).strict();
export type CustomEvaluationSyncState = z.infer<
  typeof customEvaluationSyncStateSchema
>;
export function initCustomEvaluationSyncState(): CustomEvaluationSyncState {
  return {};
}

export const reportEvaluationsPayloadSchema = z.object({
  tenantId: z.string().min(1),
  traceId: z.string().min(1),
  spanId: z.string().min(1),
  occurredAt: z.number(),
  spanStartedAt: z.number(),
});
export type ReportEvaluationsPayload = z.infer<
  typeof reportEvaluationsPayloadSchema
>;

const sdkEvaluationStatusSchema = z.enum(["processed", "skipped", "error"]);

export const sdkEvaluationSchema = z.object({
  name: z.string(),
  evaluationId: z.string().nullish().catch(null),
  evaluatorId: z.string().nullish().catch(null),
  isGuardrail: z.boolean().nullish().catch(null),
  status: sdkEvaluationStatusSchema.nullish().catch(null),
  passed: z.boolean().nullish().catch(null),
  score: z.number().nullish().catch(null),
  label: z.string().nullish().catch(null),
  details: z.string().nullish().catch(null),
  costId: z.string().nullish().catch(null),
  errorMessage: z.string().nullish().catch(null),
  errorDetails: z.string().nullish().catch(null),
});
export type SdkEvaluation = z.infer<typeof sdkEvaluationSchema>;

export interface ReportedEvaluationData {
  readonly tenantId: string;
  readonly evaluationId: string;
  readonly evaluatorId: string;
  readonly evaluatorType: "custom";
  readonly evaluatorName: string;
  readonly traceId: string;
  readonly isGuardrail?: boolean;
  readonly status: "processed" | "skipped" | "error";
  readonly score: number | null;
  readonly passed: boolean | null;
  readonly label: string | null;
  readonly details: string | null;
  readonly error: string | null;
  readonly errorDetails: string | null;
  readonly costId: string | null;
  readonly occurredAt: number;
}

export interface CustomEvaluationSyncDispatchDeps {
  /** Reads the span's custom-evaluation events back out of the span store,
   *  where `spanStorage` already wrote them once — the claim-check that keeps
   *  evaluation content out of the outbox row. Windowed on the span's own
   *  start, never on ingest time. */
  getSpanEvaluations(params: {
    tenantId: string;
    traceId: string;
    spanId: string;
    spanStartedAtMs: number;
  }): Promise<readonly SdkEvaluation[]>;
  /** Records one finished evaluation, keyed by a derived (never minted) id
   *  so a retried dispatch lands on the evaluation it already reported. */
  reportEvaluation(data: ReportedEvaluationData): Promise<void>;
}

function derivedEvaluationId(params: {
  traceId: string;
  evaluation: SdkEvaluation;
}): string {
  const hash = crypto
    .createHash("md5")
    .update(JSON.stringify(params))
    .digest("hex");
  return `eval_md5_${hash}`;
}

/** Identities the SDK may have left to us to derive. */
function reportedEvaluationIdentity(
  traceId: string,
  evaluation: SdkEvaluation,
): {
  evaluationId: string;
  evaluatorId: string;
  status: "processed" | "skipped" | "error";
} {
  return {
    evaluationId:
      evaluation.evaluationId ?? derivedEvaluationId({ traceId, evaluation }),
    evaluatorId: evaluation.evaluatorId ?? evaluation.name,
    status:
      evaluation.status ?? (evaluation.errorMessage ? "error" : "processed"),
  };
}

/** One `SdkEvaluation`, mapped onto the report the evaluation-processing
 * domain expects. */
function toReportedEvaluation(
  params: { tenantId: string; traceId: string; occurredAt: number },
  evaluation: SdkEvaluation,
): ReportedEvaluationData {
  const { tenantId, traceId, occurredAt } = params;
  return {
    tenantId,
    ...reportedEvaluationIdentity(traceId, evaluation),
    evaluatorType: "custom",
    evaluatorName: evaluation.name,
    traceId,
    isGuardrail: evaluation.isGuardrail ?? undefined,
    score: evaluation.score ?? null,
    passed: evaluation.passed ?? null,
    label: evaluation.label ?? null,
    details: evaluation.details ?? null,
    error: evaluation.errorMessage ?? null,
    errorDetails: evaluation.errorDetails ?? null,
    costId: evaluation.costId ?? null,
    occurredAt,
  };
}

/** One unreachable command must not stop this span's other evaluations from
 * being reported — collected, not swallowed. */
async function reportEach(
  deps: CustomEvaluationSyncDispatchDeps,
  params: { tenantId: string; traceId: string; occurredAt: number },
  evaluations: readonly SdkEvaluation[],
): Promise<void> {
  const failures: unknown[] = [];
  for (const evaluation of evaluations) {
    try {
      await deps.reportEvaluation(toReportedEvaluation(params, evaluation));
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw failures[0] instanceof Error
      ? failures[0]
      : new Error(String(failures[0]));
  }
}

export function reportEvaluationsIntents(
  deps: CustomEvaluationSyncDispatchDeps,
) {
  return {
    reportEvaluations: {
      payload: reportEvaluationsPayloadSchema,
      messageKey: (payload) =>
        `custom-eval:${payload.traceId}:${payload.spanId}`,
      async deliver(payload) {
        const { tenantId, traceId, spanId, spanStartedAt } = payload;
        const evaluations = await deps.getSpanEvaluations({
          tenantId,
          traceId,
          spanId,
          spanStartedAtMs: spanStartedAt,
        });

        // The narrowing already established this span carried a verdict, so
        // an empty read means the sibling span-store write hasn't landed
        // yet, not that there was nothing here. Throwing re-leases the
        // message rather than silently dropping the customer's evaluation.
        if (evaluations.length === 0) {
          throw new Error(
            `Referenced span carries no readable custom evaluation yet (trace ${traceId}, span ${spanId})`,
          );
        }

        await reportEach(deps, payload, evaluations);
      },
    } satisfies IntentDef<typeof reportEvaluationsPayloadSchema>,
  };
}
type CustomEvaluationSyncIntents = ReturnType<typeof reportEvaluationsIntents>;

function spanCarriesEvaluations(data: {
  readonly events: readonly {
    name: string;
    attributes: Readonly<Record<string, unknown>>;
  }[];
}): boolean {
  return data.events.some(
    (event) =>
      event.name === CUSTOM_EVALUATION_SPAN_EVENT_NAME &&
      typeof event.attributes[CUSTOM_EVALUATION_PAYLOAD_ATTRIBUTE] === "string",
  );
}

export const customEvaluationSyncOn: ProcessManagerHandlerMap<
  typeof traceEvents,
  CustomEvaluationSyncState,
  CustomEvaluationSyncIntents
> = {
  spanReceived(
    state,
    data,
    ctx,
  ): EvolveStep<CustomEvaluationSyncState, CustomEvaluationSyncIntents> {
    const idle = { state, intents: [], nextWakeAt: null } as const;
    if (!spanCarriesEvaluations(data)) return idle;
    if (ctx.now - data.occurredAt > STALE_TRACE_THRESHOLD_MS) return idle;
    if (!ctx.processKey) return idle;

    return {
      state,
      nextWakeAt: null,
      intents: [
        {
          type: "reportEvaluations",
          payload: {
            tenantId: ctx.tenantId,
            traceId: ctx.processKey,
            spanId: data.spanId,
            occurredAt: data.occurredAt,
            spanStartedAt: data.startTimeUnixMs,
          },
        },
      ],
    };
  },
};
