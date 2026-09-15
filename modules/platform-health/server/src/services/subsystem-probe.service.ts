/**
 * The subsystem probes themselves. Both doors — the project-keyed
 * `/api/health/*` family and the monitoring-keyed platform-health family —
 * run these, so neither owns a second copy.
 */
import { randomBytes } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import { type Instant, nowInstant, Temporal } from "@langwatch/time";
import { nanoid } from "nanoid";

const logger = createLogger("langwatch:platform-health:probes");

/** Why a probe did not pass, in a word this codebase owns. */
export type SubsystemProbeReason =
  | "canary_rest_refused"
  | "canary_otlp_refused"
  | "evaluation_refused"
  | "trace_not_ingested"
  | "trigger_absent"
  | "trigger_never_fired"
  | "trigger_stale"
  | "workflow_absent"
  | "workflow_refused";

/**
 * `message` is the sentence the project-keyed family has always answered with
 * and may quote an upstream; `reason` is the safe half, and the only half a
 * monitoring answer reads.
 */
export type SubsystemProbeOutcome =
  | Readonly<{ ok: true; status: number; body: unknown }>
  | Readonly<{ ok: false; httpStatus: 404 | 500; message: string; reason: SubsystemProbeReason }>;

/** What the probes reach that they do not own. */
export interface SubsystemProbeCollaborators {
  /** The deployment's public origin, which every canary is posted back through. */
  readonly publicBaseUrl: string;
  /** The automation application the trigger probe reads a recent fire from. */
  automation(): Readonly<{
    findById(input: { triggerId: string; projectId: string }): Promise<unknown | null>;
    getRecentFires(input: {
      projectId: string;
      triggerId: string;
      limit: number;
    }): Promise<ReadonlyArray<{ firedAt: Instant }>>;
  }>;
  /** Whether the project has the workflow the workflow probe was pointed at. */
  workflowExists(input: { workflowId: string; projectId: string }): Promise<boolean>;
}

/** The OTLP body a canary is sent as, written out rather than borrowed. */
type CanaryOtelPayload = Readonly<{
  resourceSpans: ReadonlyArray<{
    resource: { attributes: ReadonlyArray<{ key: string; value: { stringValue: string } }> };
    scopeSpans: ReadonlyArray<{
      scope: { name: string };
      spans: ReadonlyArray<{
        traceId: string;
        spanId: string;
        name: string;
        kind: string;
        startTimeUnixNano: string;
        endTimeUnixNano: string;
        attributes: ReadonlyArray<{ key: string; value: { stringValue: string } }>;
        status: Record<string, never>;
      }>;
    }>;
  }>;
}>;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const failure = (
  httpStatus: 404 | 500,
  message: string,
  reason: SubsystemProbeReason,
): SubsystemProbeOutcome => ({ ok: false, httpStatus, message, reason });

export class SubsystemProbeService {
  readonly #collaborators: SubsystemProbeCollaborators;

  private constructor(collaborators: SubsystemProbeCollaborators) {
    this.#collaborators = collaborators;
  }

  static create(options: { collaborators: SubsystemProbeCollaborators }): SubsystemProbeService {
    return new SubsystemProbeService(options.collaborators);
  }

  async runCollector({ authToken }: { authToken: string }): Promise<SubsystemProbeOutcome> {
    const [restResponse, otelResponse] = await Promise.all([
      this.#postRestCanary({ authToken, traceId: `trace_${nanoid()}`, input: "\u{1F423}" }),
      this.#postOtelCanary({
        authToken,
        traceId: Buffer.from(randomBytes(16).toString("hex"), "hex").toString("base64"),
        input: "\u{1F423}",
      }),
    ]);

    const refused = firstRefusal(restResponse, otelResponse);
    if (refused) return refused;

    return { ok: true, status: otelResponse.status, body: await otelResponse.json() };
  }

  async runEvaluations({ authToken }: { authToken: string }): Promise<SubsystemProbeOutcome> {
    const response = await this.#withRetries(() =>
      fetch(
        `${this.#collaborators.publicBaseUrl}/api/evaluations/presidio/pii_detection/evaluate`,
        {
          method: "POST",
          headers: { "X-Auth-Token": authToken, "Content-Type": "application/json" },
          body: JSON.stringify({
            data: { input: "Hello, my name is John Canary and my email is canary@langwatch.ai." },
            settings: { entities: { email_address: true, person: true } },
          }),
        },
      ),
    );

    if (!response.ok) {
      return failure(
        500,
        `Failed to run sample evaluation: ${await response.text()}`,
        "evaluation_refused",
      );
    }

    return { ok: true, status: response.status, body: await response.json() };
  }

  async runProcessor({ authToken }: { authToken: string }): Promise<SubsystemProbeOutcome> {
    const restTraceId = `trace_${nanoid()}`;
    const otelTraceId = randomBytes(16).toString("base64");
    const startedAt = nowInstant().epochMilliseconds;

    logger.info({ restTraceId, otelTraceId }, "Healthcheck started, sending canary traces");

    const [restResponse, otelResponse] = await Promise.all([
      this.#postRestCanary({ authToken, traceId: restTraceId, input: "\u{1F424}" }),
      this.#postOtelCanary({
        authToken,
        traceId: otelTraceId,
        input: "\u{1F424}",
        model: "openai/gpt-4.1-nano",
      }),
    ]);

    logger.info(
      {
        restTraceId,
        otelTraceId,
        sendDurationMs: nowInstant().epochMilliseconds - startedAt,
        restStatus: restResponse.status,
        otelStatus: otelResponse.status,
      },
      "Canary traces sent",
    );

    const refused = firstRefusal(restResponse, otelResponse);
    if (refused) return refused;

    const otelBody = await otelResponse.json();

    const ingested = await Promise.all([
      this.#awaitTrace({ traceId: restTraceId, authToken, label: "REST" }),
      this.#awaitTrace({ traceId: otelTraceId, authToken, label: "OTLP" }),
    ]);
    const missed = ingested.find((entry) => entry !== null);
    if (missed) {
      logger.warn(
        { restTraceId, otelTraceId, totalMs: nowInstant().epochMilliseconds - startedAt },
        `Healthcheck failed: ${missed}`,
      );
      return failure(500, missed, "trace_not_ingested");
    }

    logger.info(
      { restTraceId, otelTraceId, totalMs: nowInstant().epochMilliseconds - startedAt },
      "Healthcheck passed",
    );

    return { ok: true, status: otelResponse.status, body: otelBody };
  }

  async runTriggers({
    projectId,
    triggerId,
  }: {
    projectId: string;
    triggerId: string;
  }): Promise<SubsystemProbeOutcome> {
    const automation = this.#collaborators.automation();
    const trigger = await automation.findById({ triggerId, projectId });
    if (!trigger) return failure(404, "Trigger not found.", "trigger_absent");

    const [lastTriggerSent] = await automation.getRecentFires({ projectId, triggerId, limit: 1 });
    if (!lastTriggerSent) return failure(404, "No trigger sent found.", "trigger_never_fired");

    const oneHourAgo = nowInstant().subtract({ milliseconds: 60 * 60 * 1000 });
    if (Temporal.Instant.compare(lastTriggerSent.firedAt, oneHourAgo) < 0) {
      return failure(404, "Trigger not triggered within the last hour.", "trigger_stale");
    }

    return {
      ok: true,
      status: 200,
      body: { message: "Trigger triggered within the last hour." },
    };
  }

  async runWorkflows({
    projectId,
    workflowId,
    authToken,
  }: {
    projectId: string;
    workflowId: string;
    authToken: string;
  }): Promise<SubsystemProbeOutcome> {
    if (!(await this.#collaborators.workflowExists({ workflowId, projectId }))) {
      return failure(404, "Workflow not found.", "workflow_absent");
    }

    const response = await this.#withRetries(() =>
      fetch(`${this.#collaborators.publicBaseUrl}/api/workflows/${workflowId}/run`, {
        method: "POST",
        headers: { "X-Auth-Token": authToken, "Content-Type": "application/json" },
        body: JSON.stringify({ input: "\u{1F425}" }),
      }),
    );

    if (!response.ok) {
      return failure(
        500,
        `Failed to run sample workflow: ${await response.text()}`,
        "workflow_refused",
      );
    }

    return { ok: true, status: response.status, body: await response.json() };
  }

  async #withRetries(send: () => Promise<Response>): Promise<Response> {
    const maxAttempts = 3;
    let response = await send();
    for (let attempt = 1; attempt < maxAttempts && !response.ok; attempt++) {
      await sleep(1000);
      response = await send();
    }
    return response;
  }

  #postRestCanary({
    authToken,
    traceId,
    input,
  }: {
    authToken: string;
    traceId: string;
    input: string;
  }): Promise<Response> {
    const now = nowInstant().epochMilliseconds;
    return fetch(`${this.#collaborators.publicBaseUrl}/api/collector`, {
      method: "POST",
      headers: { "X-Auth-Token": authToken, "Content-Type": "application/json" },
      body: JSON.stringify({
        spans: [
          {
            trace_id: traceId,
            span_id: `span_${nanoid()}`,
            type: "span",
            input: { type: "text", value: input },
            output: { type: "text", value: "\u{1F4AF}" },
            timestamps: { started_at: now, finished_at: now },
          },
        ],
        metadata: { canary: true },
      }),
    });
  }

  #postOtelCanary({
    authToken,
    traceId,
    input,
    model,
  }: {
    authToken: string;
    traceId: string;
    input: string;
    model?: string;
  }): Promise<Response> {
    const nanos = (nowInstant().epochMilliseconds * 1000 * 1000).toString();
    const payload: CanaryOtelPayload = {
      resourceSpans: [
        {
          resource: { attributes: [{ key: "metadata.canary", value: { stringValue: "true" } }] },
          scopeSpans: [
            {
              scope: { name: "opentelemetry.langwatch.health_check" },
              spans: [
                {
                  traceId,
                  spanId: Buffer.from(randomBytes(8).toString("hex"), "hex").toString("base64"),
                  name: "Health check",
                  kind: "SPAN_KIND_INTERNAL",
                  startTimeUnixNano: nanos,
                  endTimeUnixNano: nanos,
                  attributes: [
                    ...(model === undefined
                      ? []
                      : [{ key: "gen_ai.request.model", value: { stringValue: model } }]),
                    { key: "gen_ai.prompt.0.role", value: { stringValue: "user" } },
                    { key: "gen_ai.prompt.0.content.0.text", value: { stringValue: input } },
                    { key: "gen_ai.completion.0.text", value: { stringValue: "\u{1F4AF}" } },
                  ],
                  status: {},
                },
              ],
            },
          ],
        },
      ],
    };

    return fetch(`${this.#collaborators.publicBaseUrl}/api/otel/v1/traces`, {
      method: "POST",
      headers: { "X-Auth-Token": authToken, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  /**
   * Polls until the canary comes out the other end, answering the sentence to
   * report when it never does and nothing when it arrives.
   */
  async #awaitTrace({
    traceId,
    authToken,
    label,
  }: {
    traceId: string;
    authToken: string;
    label: "REST" | "OTLP";
  }): Promise<string | null> {
    const startedAt = nowInstant().epochMilliseconds;
    const timeoutMs = 60 * 1000;
    let attempt = 0;

    while (nowInstant().epochMilliseconds - startedAt < timeoutMs) {
      await sleep(2000);
      attempt++;
      try {
        const fetchStart = nowInstant().epochMilliseconds;
        const response = await fetch(
          `${this.#collaborators.publicBaseUrl}/api/traces/${encodeURIComponent(traceId)}`,
          { headers: { "X-Auth-Token": authToken } },
        );
        const fetchMs = nowInstant().epochMilliseconds - fetchStart;
        if (response.ok) {
          logger.info({ traceId, attempt, fetchMs }, "Trace found");
          return null;
        }
        if (fetchMs > 3000) {
          logger.warn({ traceId, attempt, fetchMs, status: response.status }, "Trace poll slow");
        }
      } catch (error) {
        logger.warn({ traceId, attempt, error }, "Trace poll fetch error");
      }
    }

    logger.warn({ traceId, attempts: attempt }, "Trace poll exhausted all attempts");
    return `Failed to get ${label} trace after multiple retries`;
  }
}

/** The first canary leg our own boundary refused, where either did. */
function firstRefusal(rest: Response, otel: Response): SubsystemProbeOutcome | null {
  if (!rest.ok) {
    return failure(500, "Failed to send trace to LangWatch using REST", "canary_rest_refused");
  }
  if (!otel.ok) {
    return failure(500, "Failed to send trace to LangWatch using OTLP", "canary_otlp_refused");
  }
  return null;
}
