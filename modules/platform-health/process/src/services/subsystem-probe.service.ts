/**
 * The subsystem probes themselves. Both doors — the project-keyed
 * `/api/health/*` family and the monitoring-keyed platform-health family —
 * run these, so neither owns a second copy.
 */
import { randomBytes } from "node:crypto";

import { generate } from "@langwatch/ksuid";
import { createLogger, type Logger } from "@langwatch/observability";
import { type CanaryTransport, HealthCheckFailedError } from "@langwatch/platform-health-contract";
import { type Instant, nowInstant, Temporal } from "@langwatch/time";

import type { SubsystemProbeChannel } from "../channels/subsystem-probe.channel.ts";

const probesLogger = createLogger("langwatch:platform-health:probes");

/** Canary trace/span ids; never read back, only fed through the real ingestion path. */
const TRACE_KSUID_RESOURCE = "trace";
const SPAN_KSUID_RESOURCE = "span";

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

/**
 * The credential a probe runs as. `projectId` travels beside the token: a key
 * that self-scopes to one project cannot be re-resolved behind the public
 * boundary. Null when the credential resolves to no project.
 */
interface ProbeCredential {
  readonly authToken: string;
  readonly projectId: string | null;
  /** The request that asked for the probe; every canary it sends stops with it. */
  readonly signal: AbortSignal | undefined;
}

function canaryHeaders(authToken: string, projectId: string | null): Record<string, string> {
  return {
    "X-Auth-Token": authToken,
    ...(projectId === null ? {} : { "X-Project-Id": projectId }),
    "Content-Type": "application/json",
  };
}

function readbackHeaders(authToken: string, projectId: string | null): Record<string, string> {
  return {
    "X-Auth-Token": authToken,
    ...(projectId === null ? {} : { "X-Project-Id": projectId }),
  };
}

/** What the probes reach that they do not own. */
export interface SubsystemProbeCollaborators {
  /** The deployment's public origin, which every canary is posted back through. */
  readonly canaries: SubsystemProbeChannel;
  /** The automation application the trigger probe reads a recent fire from. */
  automation(): Readonly<{
    findById(input: { triggerId: string; projectId: string }): Promise<unknown>;
    getRecentFires(input: {
      projectId: string;
      triggerId: string;
      limit: number;
    }): Promise<readonly { firedAt: Instant }[]>;
  }>;
  /** Whether the project has the workflow the workflow probe was pointed at. */
  workflowExists(input: { workflowId: string; projectId: string }): Promise<boolean>;
}

/** The OTLP body a canary is sent as, written out rather than borrowed. */
type CanaryOtelPayload = Readonly<{
  resourceSpans: readonly {
    resource: { attributes: readonly { key: string; value: { stringValue: string } }[] };
    scopeSpans: readonly {
      scope: { name: string };
      spans: readonly {
        traceId: string;
        spanId: string;
        name: string;
        kind: string;
        startTimeUnixNano: string;
        endTimeUnixNano: string;
        attributes: readonly { key: string; value: { stringValue: string } }[];
        status: Record<string, never>;
      }[];
    }[];
  }[];
}>;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type CanaryProbe = "collector" | "processor";

/** How long a canary POST may hang before the probe calls it a failure. */
const CANARY_TIMEOUT_MS = 30_000;

const failure = (
  httpStatus: 404 | 500,
  message: string,
  reason: SubsystemProbeReason,
): SubsystemProbeOutcome => ({ ok: false, httpStatus, message, reason });

export class SubsystemProbeService {
  readonly #collaborators: SubsystemProbeCollaborators;
  readonly #logger: Pick<Logger, "info" | "warn" | "error">;

  private constructor(
    collaborators: SubsystemProbeCollaborators,
    logger: Pick<Logger, "info" | "warn" | "error">,
  ) {
    this.#collaborators = collaborators;
    this.#logger = logger;
  }

  static create(options: {
    collaborators: SubsystemProbeCollaborators;
    logger?: Pick<Logger, "info" | "warn" | "error">;
  }): SubsystemProbeService {
    return new SubsystemProbeService(options.collaborators, options.logger ?? probesLogger);
  }

  async runCollector({
    authToken,
    projectId,
    signal,
  }: ProbeCredential): Promise<SubsystemProbeOutcome> {
    const [, otelResponse] = await Promise.all([
      this.#postRestCanary({
        probe: "collector",
        authToken,
        projectId,
        signal,
        traceId: generate(TRACE_KSUID_RESOURCE).toString(),
        input: "\u{1F423}",
      }),
      this.#postOtelCanary({
        probe: "collector",
        authToken,
        projectId,
        signal,
        traceId: Buffer.from(randomBytes(16).toString("hex"), "hex").toString("base64"),
        input: "\u{1F423}",
      }),
    ]);

    return { ok: true, status: otelResponse.status, body: await otelResponse.json() };
  }

  async runEvaluations({
    authToken,
    projectId,
    signal,
  }: ProbeCredential): Promise<SubsystemProbeOutcome> {
    const response = await this.#withRetries(() =>
      this.#collaborators.canaries.post({
        path: "/api/evaluations/presidio/pii_detection/evaluate",
        headers: canaryHeaders(authToken, projectId),
        signal,
        body: JSON.stringify({
          data: { input: "Hello, my name is John Canary and my email is canary@langwatch.ai." },
          settings: { entities: { email_address: true, person: true } },
        }),
      }),
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

  async runProcessor({
    authToken,
    projectId,
    signal,
  }: ProbeCredential): Promise<SubsystemProbeOutcome> {
    const restTraceId = generate(TRACE_KSUID_RESOURCE).toString();
    const otelTraceId = randomBytes(16).toString("base64");
    const startedAt = nowInstant().epochMilliseconds;

    this.#logger.info({ restTraceId, otelTraceId }, "Healthcheck started, sending canary traces");

    const [restResponse, otelResponse] = await Promise.all([
      this.#postRestCanary({
        probe: "processor",
        authToken,
        projectId,
        signal,
        traceId: restTraceId,
        input: "\u{1F424}",
      }),
      this.#postOtelCanary({
        probe: "processor",
        authToken,
        projectId,
        signal,
        traceId: otelTraceId,
        input: "\u{1F424}",
        model: "openai/gpt-4.1-nano",
      }),
    ]);

    this.#logger.info(
      {
        restTraceId,
        otelTraceId,
        sendDurationMs: nowInstant().epochMilliseconds - startedAt,
        restStatus: restResponse.status,
        otelStatus: otelResponse.status,
      },
      "Canary traces sent",
    );

    const otelBody = await otelResponse.json();

    const ingested = await Promise.all([
      this.#awaitTrace({ traceId: restTraceId, authToken, projectId, signal, label: "REST" }),
      this.#awaitTrace({ traceId: otelTraceId, authToken, projectId, signal, label: "OTLP" }),
    ]);
    const missed = ingested.find((entry) => entry !== null);
    if (missed) {
      this.#logger.warn(
        { restTraceId, otelTraceId, totalMs: nowInstant().epochMilliseconds - startedAt },
        `Healthcheck failed: ${missed}`,
      );
      return failure(500, missed, "trace_not_ingested");
    }

    this.#logger.info(
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
    signal,
  }: {
    projectId: string;
    workflowId: string;
    authToken: string;
    signal: AbortSignal | undefined;
  }): Promise<SubsystemProbeOutcome> {
    if (!(await this.#collaborators.workflowExists({ workflowId, projectId }))) {
      return failure(404, "Workflow not found.", "workflow_absent");
    }

    const response = await this.#withRetries(() =>
      this.#collaborators.canaries.post({
        path: `/api/workflows/${workflowId}/run`,
        headers: canaryHeaders(authToken, projectId),
        signal,
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
    probe,
    authToken,
    projectId,
    signal,
    traceId,
    input,
  }: ProbeCredential & {
    probe: CanaryProbe;
    traceId: string;
    input: string;
  }): Promise<Response> {
    const now = nowInstant().epochMilliseconds;
    return this.#sendCanary({
      probe,
      transport: "rest",
      path: "/api/collector",
      headers: canaryHeaders(authToken, projectId),
      signal,
      body: JSON.stringify({
        spans: [
          {
            trace_id: traceId,
            span_id: generate(SPAN_KSUID_RESOURCE).toString(),
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
    probe,
    authToken,
    projectId,
    signal,
    traceId,
    input,
    model,
  }: ProbeCredential & {
    probe: CanaryProbe;
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

    return this.#sendCanary({
      probe,
      transport: "otlp",
      path: "/api/otel/v1/traces",
      headers: canaryHeaders(authToken, projectId),
      signal,
      body: JSON.stringify(payload),
    });
  }

  /**
   * One canary POST back through our own boundary. A network-level failure and
   * a refusal are the same handled outcome, and the transport cause is logged
   * here because the wire masks a non-handled reason.
   */
  async #sendCanary({
    probe,
    transport,
    path,
    headers,
    body,
    signal,
  }: {
    probe: CanaryProbe;
    transport: CanaryTransport;
    path: string;
    headers: Readonly<Record<string, string>>;
    body: string;
    signal: AbortSignal | undefined;
  }): Promise<Response> {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), CANARY_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.#collaborators.canaries.post({
        path,
        headers,
        body,
        signal: signal === undefined ? deadline.signal : AbortSignal.any([signal, deadline.signal]),
      });
    } catch (error) {
      this.#logger.error({ probe, transport, path, error }, "Health canary transport failed");
      throw new HealthCheckFailedError({
        probe,
        transport,
        reasons: [error instanceof Error ? error : new Error(String(error))],
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      this.#logger.error(
        { probe, transport, path, upstreamStatus: response.status },
        "Health canary refused by our own boundary",
      );
      throw new HealthCheckFailedError({ probe, transport, upstreamStatus: response.status });
    }
    return response;
  }

  /**
   * Polls until the canary comes out the other end, answering the sentence to
   * report when it never does and nothing when it arrives.
   */
  async #awaitTrace({
    traceId,
    authToken,
    projectId,
    signal,
    label,
  }: ProbeCredential & {
    traceId: string;
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
        const response = await this.#collaborators.canaries.get({
          path: `/api/traces/${encodeURIComponent(traceId)}`,
          headers: readbackHeaders(authToken, projectId),
          signal,
        });
        const fetchMs = nowInstant().epochMilliseconds - fetchStart;
        if (response.ok) {
          this.#logger.info({ traceId, attempt, fetchMs }, "Trace found");
          return null;
        }
        if (fetchMs > 3000) {
          this.#logger.warn(
            { traceId, attempt, fetchMs, status: response.status },
            "Trace poll slow",
          );
        }
      } catch (error) {
        this.#logger.warn({ traceId, attempt, error }, "Trace poll fetch error");
      }
    }

    this.#logger.warn({ traceId, attempts: attempt }, "Trace poll exhausted all attempts");
    return `Failed to get ${label} trace after multiple retries`;
  }
}
