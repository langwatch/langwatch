import {
  DATA_PRIVACY_PRESIDIO_TIMEOUT_MS,
  EMPTY_AUDIENCE,
  type PiiLevel,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import { type PiiRedactionSpendPricedEventData } from "@langwatch/data-privacy-contract/pii-redaction-spend";
import {
  LangevalsPiiDetectionError,
  type PiiDetectionOutcome,
  type PiiDetectionRequest,
} from "@langwatch/evaluation-contract";
import { createTenantId } from "@langwatch/eventing";
import type { FeatureFlagApi, FeatureFlagTarget } from "@langwatch/feature-flag-contract";
import type { OtlpSpan } from "@langwatch/otlp/trace-request";
import { STRICT_ONLY_PII_ENTITIES } from "@langwatch/redaction";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  dataPrivacyTestGraph,
  dataPrivacyTestPlacement,
} from "../../app/__tests__/data-privacy.fixture.ts";
import { AwsPiiRedactionModelChannel } from "../../channels/aws.pii-redaction-model.channel.ts";
import { MemoryGoogleDlpChannel } from "../../channels/memory/memory.google-dlp.channel.ts";
import { MemoryPresidioChannel } from "../../channels/memory/memory.presidio.channel.ts";
import type { PresidioChannel } from "../../channels/presidio.channel.ts";
import type { DataPrivacyProjectScopeRepository } from "../../repositories/data-privacy-project-scope.repository.ts";
import { MemoryDataPrivacyProjectScopeRepository } from "../../repositories/memory/memory.data-privacy-project-scope.repository.ts";
import {
  PII_REDACTION_MODEL_BREAKER_COOLDOWN_MS,
  PII_REDACTION_MODEL_TIMEOUT_MS,
} from "../../rules/pii-redaction-model.rules.ts";
import { piiRedactionRequestIdKey } from "../../rules/pii-redaction-spend.rules.ts";
import { DataPrivacyProjectScopeService } from "../data-privacy-project-scope.service.ts";
import { GoogleDlpRedactionService } from "../google-dlp-redaction.service.ts";
import { OtlpSpanPiiRedactionService } from "../otlp-span-pii-redaction.service.ts";
import type { PiiRedactionModelFallbackReason } from "../pii-analysis-metrics-otel.service.ts";
import { PiiAnalysisService } from "../pii-analysis.service.ts";
import {
  type PiiRedactionModelUsage,
  PiiRedactionModelService,
} from "../pii-redaction-model.service.ts";
import { PiiRedactionPolicyService } from "../pii-redaction-policy.service.ts";
import { PiiRedactionSpendService } from "../pii-redaction-spend.service.ts";
import { PresidioRedactionService } from "../presidio-redaction.service.ts";

const PROJECT_ID = dataPrivacyTestGraph.projectId;
const ORGANIZATION_ID = dataPrivacyTestGraph.organizationId;

const metrics = {
  analysisCalled: () => void 0,
  analysisObserved: () => void 0,
  analysisFinished: () => void 0,
};

const anonymized = (text: string): PiiDetectionOutcome => ({
  kind: "detected",
  results: [{ status: "processed", raw_response: { anonymized: text } }],
});

/** Answers the configured probe, then never answers a real batch until it is aborted. */
const hangingModel: PresidioChannel = {
  detect: (input: PiiDetectionRequest) =>
    input.texts.length === 0
      ? Promise.resolve({ kind: "detected", results: [] })
      : new Promise((_resolve, reject) => {
          input.signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
};

/** A Presidio that never answers until its abort signal fires, keeping each signal it is sent. */
function hangingPresidio() {
  const signals: AbortSignal[] = [];
  const channel: PresidioChannel = {
    detect: (input: PiiDetectionRequest) => {
      signals.push(input.signal);
      return new Promise((_resolve, reject) => {
        input.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    },
  };
  return { signals, channel };
}

/** A Lambda client whose invoke never answers until its abort signal fires, as the SDK does. */
function hangingLambda() {
  const signals: AbortSignal[] = [];
  const lambda = {
    send: (_command: unknown, options: { abortSignal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        const signal = options.abortSignal;
        if (!signal) return reject(new Error("invoke sent without an abort signal"));
        signals.push(signal);
        signal.addEventListener("abort", () => {
          const aborted = new Error("Request aborted");
          aborted.name = "AbortError";
          reject(aborted);
        });
      }),
  } as never;
  return {
    signals,
    channel: AwsPiiRedactionModelChannel.create({
      lambda,
      functionArn:
        "arn:aws:lambda:eu-central-1:123456789012:function:langwatch-pii-redaction-model-all:live",
    }),
  };
}

/** How the scripted model meets one batch. */
type ModelTurn =
  | { kind: "answer"; afterMs?: number }
  | { kind: "hang" }
  | { kind: "stall" }
  | { kind: "throttle" }
  | { kind: "refuse" };

/**
 * A model that meets each batch as its script says, as the Lambda channel would: a hang ends in
 * the SDK's AbortError at the time cap, a throttle in Lambda's TooManyRequestsException. A stall
 * ignores the abort and never settles.
 */
function scriptedModel(turns: ModelTurn[]) {
  const batches: string[][] = [];
  const channel: PresidioChannel = {
    detect: (input: PiiDetectionRequest) => {
      if (input.texts.length === 0) return Promise.resolve({ kind: "detected", results: [] });
      batches.push([...input.texts]);
      const turn = turns.shift() ?? { kind: "answer" };
      if (turn.kind === "stall") return new Promise(() => void 0);
      return new Promise((resolve, reject) => {
        input.signal.addEventListener("abort", () => {
          const aborted = new Error("Request aborted");
          aborted.name = "AbortError";
          reject(aborted);
        });
        if (turn.kind === "answer") {
          const answer = () => resolve(anonymized("call <PERSON>"));
          if (turn.afterMs) setTimeout(answer, turn.afterMs);
          else answer();
        } else if (turn.kind === "throttle") {
          const throttled = new Error("Rate exceeded");
          throttled.name = "TooManyRequestsException";
          reject(throttled);
        } else if (turn.kind === "refuse") {
          reject(new LangevalsPiiDetectionError("PII redaction model answered 500"));
        }
      });
    },
  };
  return { batches, channel };
}

function setup({
  modelConfigured = true,
  allowlisted = true,
  flagFails = false,
  model,
  modelTimeoutMs = 60_000,
  presidioChannel,
}: {
  modelConfigured?: boolean;
  allowlisted?: boolean;
  flagFails?: boolean;
  model?: PresidioChannel;
  modelTimeoutMs?: number;
  presidioChannel?: PresidioChannel;
} = {}) {
  const presidio = MemoryPresidioChannel.create({ endpoint: "http://langevals:5562" });
  const memoryModel = MemoryPresidioChannel.create(
    modelConfigured ? { endpoint: "http://pii-redaction-model:8080" } : {},
  );
  const dlp = MemoryGoogleDlpChannel.create();

  const flagReads: { key: string; target: FeatureFlagTarget }[] = [];
  const featureFlags = createApiFixture<FeatureFlagApi>({
    isEnabled: async (key, target) => {
      flagReads.push({ key, target });
      if (flagFails) throw new Error("flag store unreachable");
      return allowlisted;
    },
  });

  const placements = MemoryDataPrivacyProjectScopeRepository.create({
    projects: [dataPrivacyTestPlacement()],
  });
  const scopeReads: string[] = [];
  let scopeReadFails = false;
  const repository: DataPrivacyProjectScopeRepository = {
    find: async (input) => {
      scopeReads.push(input.projectId);
      if (scopeReadFails) {
        scopeReadFails = false;
        throw new Error("database unreachable");
      }
      return placements.find(input);
    },
  };
  const failNextScopeRead = () => {
    scopeReadFails = true;
  };

  const fallbacks: PiiRedactionModelFallbackReason[] = [];
  const usage: { level: "info" | "warn"; fields: PiiRedactionModelUsage; message: string }[] = [];
  const priced: PiiRedactionSpendPricedEventData[] = [];
  const spend = PiiRedactionSpendService.create({
    requestIdKey: piiRedactionRequestIdKey("test-key-pepper"),
    featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled: async () => false }),
    recordSpendPriced: async (fact) => {
      priced.push(fact);
    },
  });

  const analysis = PiiAnalysisService.create({
    presidio: PresidioRedactionService.create({
      presidio: presidioChannel ?? presidio,
      metrics,
      timeoutMs: DATA_PRIVACY_PRESIDIO_TIMEOUT_MS,
    }),
    model: PiiRedactionModelService.create({
      model: PresidioRedactionService.create({
        presidio: model ?? memoryModel,
        metrics,
        timeoutMs: modelTimeoutMs,
        method: "pii_redaction_model",
      }),
      featureFlags,
      scopes: DataPrivacyProjectScopeService.create({ repository }),
      spend,
      metrics: { modelFellBack: (reason) => fallbacks.push(reason) },
      log: {
        info: (fields, message) => usage.push({ level: "info", fields, message }),
        warn: (fields, message) => usage.push({ level: "warn", fields, message }),
      },
      now: () => Date.now(),
    }),
    dlp: GoogleDlpRedactionService.create({ dlp, disabled: false, metrics }),
  });

  /** The batches each service was actually sent, leaving out the empty configured probe. */
  const sent = (channel: MemoryPresidioChannel) =>
    channel.batches.filter((batch) => batch.texts.length > 0);

  return {
    analysis,
    presidio,
    memoryModel,
    dlp,
    flagReads,
    scopeReads,
    failNextScopeRead,
    sent,
    fallbacks,
    usage,
    priced,
  };
}

const strictBatch = (
  { projectId }: { projectId: string | undefined } = { projectId: PROJECT_ID },
) => ({
  texts: ["call Ana"],
  piiRedactionLevel: "STRICT" as const,
  resolvedPiiLevel: "strict" as const,
  projectId,
});

/** A resolved policy at the given PII level, capturing every category. */
function policyAt({
  level,
  entities = [],
}: {
  level: PiiLevel;
  entities?: string[];
}): ResolvedDataPrivacy {
  const capture = () => ({ disposition: "capture" as const, audience: { ...EMPTY_AUDIENCE } });
  return {
    categories: { input: capture(), output: capture(), system: capture(), tools: capture() },
    pii: { level, entities, exceptPatterns: [] },
    secrets: { enabled: false, customPatterns: [] },
    customAttributes: [],
  };
}

function spanWith(value: string): OtlpSpan {
  return {
    traceId: "trace-1",
    spanId: "span-1",
    name: "llm",
    kind: 1,
    startTimeUnixNano: "1",
    endTimeUnixNano: "2",
    attributes: [{ key: "langwatch.input", value: { stringValue: value } }],
    events: [],
    links: [],
    status: {},
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
}

describe("PiiRedactionModelService", () => {
  describe("given an organization allowlisted for the model", () => {
    /** @scenario "An allowlisted organization's strict analysis goes to the PII redaction model" */
    it("sends the batch to the model and leaves Presidio uncalled", async () => {
      const { analysis, presidio, memoryModel, flagReads, sent } = setup();
      memoryModel.answerWith(anonymized("call <PERSON>"));

      const cleared = await analysis.clearPresidio(strictBatch());

      expect(cleared).toEqual(["call [PERSON]"]);
      expect(sent(memoryModel)).toHaveLength(1);
      expect(sent(presidio)).toHaveLength(0);
      expect(flagReads).toEqual([
        {
          key: "release_pii_redaction_model_enabled",
          target: { kind: "project", projectId: PROJECT_ID, organizationId: ORGANIZATION_ID },
        },
      ]);
    });

    it("reads the project's organization once for consecutive batches", async () => {
      const { analysis, memoryModel, scopeReads } = setup();
      memoryModel.answerWith(anonymized("call <PERSON>"));
      memoryModel.answerWith(anonymized("call <PERSON>"));

      await analysis.clearPresidio(strictBatch());
      await analysis.clearPresidio(strictBatch());

      expect(scopeReads).toEqual([PROJECT_ID]);
    });

    it("reads the project's organization once for concurrent batches", async () => {
      const { analysis, memoryModel, scopeReads } = setup();
      memoryModel.answerWith(anonymized("call <PERSON>"));
      memoryModel.answerWith(anonymized("call <PERSON>"));
      memoryModel.answerWith(anonymized("call <PERSON>"));

      const cleared = await Promise.all([
        analysis.clearPresidio(strictBatch()),
        analysis.clearPresidio(strictBatch()),
        analysis.clearPresidio(strictBatch()),
      ]);

      expect(cleared).toEqual([["call [PERSON]"], ["call [PERSON]"], ["call [PERSON]"]]);
      expect(scopeReads).toEqual([PROJECT_ID]);
    });

    it("reads the organization again after a failed lookup", async () => {
      const { analysis, memoryModel, presidio, scopeReads, failNextScopeRead } = setup();
      presidio.answerWith(anonymized("call <PERSON>"));
      memoryModel.answerWith(anonymized("call <PERSON>"));
      failNextScopeRead();

      await expect(analysis.clearPresidio(strictBatch())).resolves.toEqual(["call [PERSON]"]);
      await expect(analysis.clearPresidio(strictBatch())).resolves.toEqual(["call [PERSON]"]);

      expect(scopeReads).toEqual([PROJECT_ID, PROJECT_ID]);
    });

    describe("when the organization lookup is a minute old", () => {
      afterEach(() => {
        vi.useRealTimers();
      });

      it("reads the project's organization again", async () => {
        vi.useFakeTimers();
        const { analysis, memoryModel, scopeReads } = setup();
        memoryModel.answerWith(anonymized("call <PERSON>"));
        memoryModel.answerWith(anonymized("call <PERSON>"));
        memoryModel.answerWith(anonymized("call <PERSON>"));

        await analysis.clearPresidio(strictBatch());
        await vi.advanceTimersByTimeAsync(59_999);
        await analysis.clearPresidio(strictBatch());
        expect(scopeReads).toEqual([PROJECT_ID]);

        await vi.advanceTimersByTimeAsync(1);
        await expect(analysis.clearPresidio(strictBatch())).resolves.toEqual(["call [PERSON]"]);
        expect(scopeReads).toEqual([PROJECT_ID, PROJECT_ID]);
      });
    });
  });

  describe("when a batch is routed to the model", () => {
    /** @scenario "Each PII redaction model call leaves one usage log line" */
    it("logs one line with counts and ids, and no text or finding value", async () => {
      const { analysis, memoryModel, fallbacks, usage } = setup();
      memoryModel.answerWith({
        kind: "detected",
        results: [
          {
            status: "processed",
            raw_response: {
              anonymized: "call <PERSON> at <PHONE_NUMBER>",
              results: [
                { entity_type: "PERSON", start: 5, end: 8, score: 0.9 },
                { entity_type: "PHONE_NUMBER", start: 12, end: 24, score: 0.9 },
              ],
            },
          },
          { status: "skipped" },
        ],
      });

      await analysis.clearPresidio({
        texts: ["call Ana at +3161234567", "nothing here"],
        piiRedactionLevel: "STRICT",
        resolvedPiiLevel: "strict",
        projectId: PROJECT_ID,
      });

      expect(usage).toHaveLength(1);
      const [line] = usage;
      expect(line!.level).toBe("info");
      expect(line!.message).toBe("PII redaction model call");
      expect(line!.fields).toEqual({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        texts: 2,
        characters: 35,
        spansFound: 2,
        outcome: "ok",
        durationMs: expect.any(Number),
      });
      const written = JSON.stringify(line);
      expect(written).not.toContain("Ana");
      expect(written).not.toContain("3161234567");
      expect(written).not.toContain("nothing here");
      expect(fallbacks).toEqual([]);
    });

    /** @scenario "Each PII redaction model call leaves one usage log line" */
    it("logs a refusal as an error with its class name only, and counts it", async () => {
      const { analysis, presidio, fallbacks, usage } = setup();
      presidio.answerWith(anonymized("call <PERSON>"));

      await analysis.clearPresidio(strictBatch());

      expect(fallbacks).toEqual(["error"]);
      expect(usage).toHaveLength(1);
      expect(usage[0]!.level).toBe("warn");
      expect(usage[0]!.fields).toMatchObject({
        outcome: "error",
        errorName: "Error",
        spansFound: 0,
        texts: 1,
        characters: 8,
      });
      expect(JSON.stringify(usage[0])).not.toContain("Ana");
    });

    describe("when the model has not answered in time", () => {
      afterEach(() => {
        vi.useRealTimers();
      });

      /** @scenario "Each PII redaction model call leaves one usage log line" */
      it("logs the call as a timeout and counts the fallback", async () => {
        vi.useFakeTimers();
        const lambda = hangingLambda();
        const { analysis, presidio, fallbacks, usage } = setup({
          model: lambda.channel,
          modelTimeoutMs: PII_REDACTION_MODEL_TIMEOUT_MS,
        });
        presidio.answerWith(anonymized("call <PERSON>"));

        const cleared = analysis.clearPresidio(strictBatch());
        await vi.advanceTimersByTimeAsync(PII_REDACTION_MODEL_TIMEOUT_MS);
        await cleared;

        expect(fallbacks).toEqual(["timeout"]);
        expect(usage).toHaveLength(1);
        expect(usage[0]!.level).toBe("warn");
        expect(usage[0]!.fields).toMatchObject({ outcome: "timeout", errorName: "AbortError" });
        expect(usage[0]!.fields.durationMs).toBeGreaterThanOrEqual(PII_REDACTION_MODEL_TIMEOUT_MS);
      });
    });

    it("counts a routing that cannot be decided as a fallback", async () => {
      const { analysis, presidio, fallbacks, usage } = setup({ flagFails: true });
      presidio.answerWith(anonymized("call <PERSON>"));

      await analysis.clearPresidio(strictBatch());

      expect(fallbacks).toEqual(["routing_error"]);
      expect(usage).toHaveLength(0);
    });
  });

  describe("given an allowlisted organization, by its resolved privacy policy", () => {
    /** The whole redaction pass, its policy resolved as `resolve` says. */
    function redactionUnder({
      analysis,
      resolve,
    }: {
      analysis: PiiAnalysisService;
      resolve: () => Promise<ResolvedDataPrivacy>;
    }) {
      return OtlpSpanPiiRedactionService.create({
        transport: analysis,
        isLangevalsConfigured: async () => true,
        isProduction: true,
        nativePolicyEnforced: true,
        piiRedactionMaxAttributeLength: 400_000,
        dataPrivacy: { getResolvedForProject: resolve },
      });
    }

    /** A span redacted through the whole span pass. */
    async function redactSpanUnder(input: {
      analysis: PiiAnalysisService;
      resolve: () => Promise<ResolvedDataPrivacy>;
    }) {
      const service = redactionUnder(input);
      const span = spanWith("call Ana");
      await service.redactSpan({
        span,
        resource: null,
        piiRedactionLevel: "STRICT",
        tenantId: createTenantId(PROJECT_ID),
      });
      return span.attributes[0]?.value.stringValue;
    }

    /** @scenario "Only a resolved strict policy reaches the PII redaction model" */
    it("sends a strict policy's batch to the model", async () => {
      const { analysis, presidio, memoryModel, sent } = setup();
      memoryModel.answerWith(anonymized("call <PERSON>"));

      const redacted = await redactSpanUnder({
        analysis,
        resolve: async () => policyAt({ level: "strict" }),
      });

      expect(redacted).toBe("call [PERSON]");
      expect(sent(memoryModel)).toHaveLength(1);
      expect(sent(presidio)).toHaveLength(0);
    });

    /** @scenario "Only a resolved strict policy reaches the PII redaction model" */
    it("sends a custom policy's batch to Presidio, though the request says STRICT", async () => {
      const { analysis, presidio, memoryModel, flagReads, sent } = setup();
      presidio.answerWith(anonymized("call <PERSON>"));

      const redacted = await redactSpanUnder({
        analysis,
        // Every analysis-service entity, so the batch is the one a strict policy sends.
        resolve: async () => policyAt({ level: "custom", entities: [...STRICT_ONLY_PII_ENTITIES] }),
      });

      expect(redacted).toBe("call [PERSON]");
      expect(sent(presidio)).toHaveLength(1);
      expect(sent(memoryModel)).toHaveLength(0);
      expect(flagReads).toHaveLength(0);
    });

    /** @scenario "Only a resolved strict policy reaches the PII redaction model" */
    it("sends the batch to Presidio when the policy cannot be loaded", async () => {
      const { analysis, presidio, memoryModel, flagReads, sent } = setup();
      presidio.answerWith(anonymized("call <PERSON>"));

      const redacted = await redactSpanUnder({
        analysis,
        resolve: () => Promise.reject(new Error("database unreachable")),
      });

      expect(redacted).toBe("call [PERSON]");
      expect(sent(presidio)).toHaveLength(1);
      expect(sent(memoryModel)).toHaveLength(0);
      expect(flagReads).toHaveLength(0);
    });

    it("sends a strict policy's log record to the model too", async () => {
      const { analysis, presidio, memoryModel, sent } = setup();
      memoryModel.answerWith(anonymized("call <PERSON>"));
      const log = { body: "call Ana", attributes: {}, resourceAttributes: {} };

      await redactionUnder({
        analysis,
        resolve: async () => policyAt({ level: "strict" }),
      }).redactLog(log, "STRICT", createTenantId(PROJECT_ID));

      expect(log.body).toBe("call [PERSON]");
      expect(sent(memoryModel)).toHaveLength(1);
      expect(sent(presidio)).toHaveLength(0);
    });

    it("keeps a batch with no resolved level on Presidio without asking the flag", async () => {
      const { analysis, presidio, memoryModel, flagReads, sent } = setup();
      presidio.answerWith(anonymized("call <PERSON>"));

      await analysis.clearPresidio({ ...strictBatch(), resolvedPiiLevel: undefined });

      expect(sent(memoryModel)).toHaveLength(0);
      expect(flagReads).toHaveLength(0);
    });
  });

  describe("when the model answers a batch, for billing", () => {
    /** @scenario "An answered batch is priced at the published rate per character" */
    it("records one priced fact for the organization and the project", async () => {
      const { analysis, memoryModel, priced } = setup();
      memoryModel.answerWith(anonymized("call <PERSON>"));

      await analysis.clearPresidio(strictBatch());

      expect(priced).toEqual([
        expect.objectContaining({
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          characters: 8,
          texts: 1,
          priceNanoUsd: 4_000,
        }),
      ]);
    });

    /** @scenario "A batch the model did not answer is not priced" */
    it("records nothing when the model refuses and Presidio answers", async () => {
      const { analysis, presidio, priced } = setup();
      presidio.answerWith(anonymized("call <PERSON>"));

      await analysis.clearPresidio(strictBatch());

      expect(priced).toEqual([]);
    });

    /** @scenario "A batch the model did not answer is not priced" */
    it("records nothing when the model times out, nor while the model is skipped after", async () => {
      const abortingModel: PresidioChannel = {
        detect: (input: PiiDetectionRequest) =>
          input.texts.length === 0
            ? Promise.resolve({ kind: "detected", results: [] })
            : new Promise((_resolve, reject) => {
                input.signal.addEventListener("abort", () =>
                  reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
                );
              }),
      };
      const { analysis, presidio, priced, fallbacks } = setup({
        model: abortingModel,
        modelTimeoutMs: 5,
      });
      presidio.answerWith(anonymized("call <PERSON>"));
      presidio.answerWith(anonymized("call <PERSON>"));

      await analysis.clearPresidio(strictBatch());
      await analysis.clearPresidio(strictBatch());

      expect(fallbacks).toEqual(["timeout", "breaker_open"]);
      expect(priced).toEqual([]);
    });

    /** @scenario "A batch the model did not answer is not priced" */
    it("records nothing for a batch too long for the model", async () => {
      const { analysis, presidio, priced } = setup();
      presidio.answerWith(anonymized("x"));

      await analysis.clearPresidio({ ...strictBatch(), texts: ["x".repeat(8_001)] });

      expect(priced).toEqual([]);
    });

    /** @scenario "An organization that is not allowlisted is never priced" */
    it("records nothing for an organization not allowlisted", async () => {
      const { analysis, presidio, priced } = setup({ allowlisted: false });
      presidio.answerWith(anonymized("call <PERSON>"));

      await analysis.clearPresidio(strictBatch());

      expect(priced).toEqual([]);
    });

    describe("given spans redacted through the whole span pass", () => {
      async function redactSpans(spans: OtlpSpan[]) {
        const { analysis, memoryModel, priced } = setup();
        const service = OtlpSpanPiiRedactionService.create({
          transport: analysis,
          isLangevalsConfigured: async () => true,
          isProduction: true,
          nativePolicyEnforced: true,
          piiRedactionMaxAttributeLength: 400_000,
          dataPrivacy: { getResolvedForProject: async () => policyAt({ level: "strict" }) },
        });
        for (const span of spans) {
          memoryModel.answerWith(anonymized("call <PERSON>"));
          await service.redactSpan({
            span,
            resource: null,
            piiRedactionLevel: "STRICT",
            tenantId: createTenantId(PROJECT_ID),
          });
        }
        return priced.map((fact) => fact.requestId);
      }

      /** @scenario "The same span redacted twice is one request" */
      it("gives a span redacted twice the same request id", async () => {
        const [first, again] = await redactSpans([spanWith("call Ana"), spanWith("call Ana")]);

        expect(again).toBe(first);
      });

      /** @scenario "Two spans with the same text are two requests" */
      it("gives two spans with the same text different request ids", async () => {
        const other = { ...spanWith("call Ana"), spanId: "span-2" };

        const [first, second] = await redactSpans([spanWith("call Ana"), other]);

        expect(second).not.toBe(first);
      });
    });
  });

  describe("given an organization not allowlisted for the model", () => {
    /** @scenario "An organization not allowlisted keeps the Presidio path" */
    it("sends the batch to Presidio and nothing to the model", async () => {
      const { analysis, presidio, memoryModel, sent } = setup({ allowlisted: false });
      presidio.answerWith(anonymized("call <PERSON>"));

      const cleared = await analysis.clearPresidio(strictBatch());

      expect(cleared).toEqual(["call [PERSON]"]);
      expect(sent(presidio)).toHaveLength(1);
      expect(sent(memoryModel)).toHaveLength(0);
    });

    it("leaves no usage line and counts no fallback", async () => {
      const { analysis, presidio, fallbacks, usage } = setup({ allowlisted: false });
      presidio.answerWith(anonymized("call <PERSON>"));

      await analysis.clearPresidio(strictBatch());

      expect(usage).toHaveLength(0);
      expect(fallbacks).toHaveLength(0);
    });

    it("keeps a batch with no project on Presidio without asking the flag", async () => {
      const { analysis, presidio, flagReads } = setup();
      presidio.answerWith(anonymized("call <PERSON>"));

      await analysis.clearPresidio(strictBatch({ projectId: void 0 }));

      expect(flagReads).toHaveLength(0);
    });
  });

  describe("when the model fails for an allowlisted organization", () => {
    /** @scenario "A model failure falls back to Presidio, never to unredacted text" */
    it("sends the batch to Presidio when the model refuses", async () => {
      const { analysis, presidio, memoryModel, sent } = setup();
      presidio.answerWith(anonymized("call <PERSON>"));

      const cleared = await analysis.clearPresidio(strictBatch());

      expect(sent(memoryModel)).toHaveLength(1);
      expect(cleared).toEqual(["call [PERSON]"]);
    });

    /** @scenario "A model failure falls back to Presidio, never to unredacted text" */
    it("sends the batch to Presidio when the model runs out of time", async () => {
      const { analysis, presidio } = setup({ model: hangingModel, modelTimeoutMs: 5 });
      presidio.answerWith(anonymized("call <PERSON>"));

      await expect(analysis.clearPresidio(strictBatch())).resolves.toEqual(["call [PERSON]"]);
    });

    describe("when the model has not answered at the time cap", () => {
      afterEach(() => {
        vi.useRealTimers();
      });

      /** @scenario "A slow model call is aborted at 50 seconds" */
      it("aborts the Lambda invoke at 50 seconds and sends the batch to Presidio", async () => {
        vi.useFakeTimers();
        const lambda = hangingLambda();
        const { analysis, presidio, sent } = setup({
          model: lambda.channel,
          modelTimeoutMs: PII_REDACTION_MODEL_TIMEOUT_MS,
        });
        presidio.answerWith(anonymized("call <PERSON>"));

        const cleared = analysis.clearPresidio(strictBatch());
        await vi.advanceTimersByTimeAsync(PII_REDACTION_MODEL_TIMEOUT_MS - 1);
        expect(lambda.signals).toHaveLength(1);
        expect(lambda.signals[0]!.aborted).toBe(false);
        expect(sent(presidio)).toHaveLength(0);

        await vi.advanceTimersByTimeAsync(1);

        expect(lambda.signals[0]!.aborted).toBe(true);
        await expect(cleared).resolves.toEqual(["call [PERSON]"]);
        expect(sent(presidio)).toHaveLength(1);
      });

      /** @scenario "A slow model call is aborted at 50 seconds" */
      it("gives Presidio its own full timeout, so DLP is reached after 110 seconds at most", async () => {
        vi.useFakeTimers();
        expect(PII_REDACTION_MODEL_TIMEOUT_MS).toBe(50_000);
        expect(DATA_PRIVACY_PRESIDIO_TIMEOUT_MS).toBe(60_000);
        const lambda = hangingLambda();
        const slowPresidio = hangingPresidio();
        const { analysis, dlp } = setup({
          model: lambda.channel,
          modelTimeoutMs: PII_REDACTION_MODEL_TIMEOUT_MS,
          presidioChannel: slowPresidio.channel,
        });
        dlp.answerWith([{ start: 5, end: 8, quote: "Ana", infoType: "PERSON_NAME" }]);
        const policy = PiiRedactionPolicyService.create({
          transport: analysis,
          isLangevalsConfigured: async () => true,
          isProduction: true,
          nativePolicyEnforced: true,
          piiRedactionMaxAttributeLength: 400_000,
          dataPrivacy: { getResolvedForProject: () => Promise.reject(new Error("unused")) },
        });

        const cleared = policy.clearBatch([{ text: "call Ana", isNameExempt: false }], {
          piiRedactionLevel: "STRICT",
          resolvedPiiLevel: "strict",
          mainMethod: "presidio",
          projectId: PROJECT_ID,
        });
        await vi.advanceTimersByTimeAsync(PII_REDACTION_MODEL_TIMEOUT_MS);
        expect(lambda.signals[0]!.aborted).toBe(true);
        expect(slowPresidio.signals).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(DATA_PRIVACY_PRESIDIO_TIMEOUT_MS - 1);
        expect(slowPresidio.signals[0]!.aborted).toBe(false);
        expect(dlp.inspections).toHaveLength(0);

        await vi.advanceTimersByTimeAsync(1);
        expect(slowPresidio.signals[0]!.aborted).toBe(true);
        await expect(cleared).resolves.toEqual(["call [REDACTED]"]);
        expect(dlp.inspections).toHaveLength(1);
      });
    });

    /** @scenario "A model failure falls back to Presidio, never to unredacted text" */
    it("sends the batch to Presidio when the flag cannot be read", async () => {
      const { analysis, presidio, memoryModel, sent } = setup({ flagFails: true });
      presidio.answerWith(anonymized("call <PERSON>"));

      await expect(analysis.clearPresidio(strictBatch())).resolves.toEqual(["call [PERSON]"]);
      expect(sent(memoryModel)).toHaveLength(0);
    });

    /** @scenario "A model failure falls back to Presidio, never to unredacted text" */
    it("reaches the Google DLP fallback when Presidio fails too", async () => {
      const { analysis, dlp, presidio, memoryModel, sent } = setup();
      dlp.answerWith([{ start: 5, end: 8, quote: "Ana", infoType: "PERSON_NAME" }]);
      const policy = PiiRedactionPolicyService.create({
        transport: analysis,
        isLangevalsConfigured: async () => true,
        isProduction: true,
        nativePolicyEnforced: true,
        piiRedactionMaxAttributeLength: 400_000,
        dataPrivacy: { getResolvedForProject: () => Promise.reject(new Error("unused")) },
      });

      const cleared = await policy.clearBatch([{ text: "call Ana", isNameExempt: false }], {
        piiRedactionLevel: "STRICT",
        resolvedPiiLevel: "strict",
        mainMethod: "presidio",
        projectId: PROJECT_ID,
      });

      expect(sent(memoryModel)).toHaveLength(1);
      expect(sent(presidio)).toHaveLength(1);
      expect(dlp.inspections).toHaveLength(1);
      expect(cleared).toEqual(["call [REDACTED]"]);
    });
  });

  describe("given a deployment that names no model", () => {
    /** @scenario "A deployment that names no model behaves exactly as today" */
    it("sends the batch to Presidio without reading the flag or the project", async () => {
      const { analysis, presidio, flagReads, scopeReads, sent } = setup({ modelConfigured: false });
      presidio.answerWith(anonymized("call <PERSON>"));

      const cleared = await analysis.clearPresidio(strictBatch());

      expect(cleared).toEqual(["call [PERSON]"]);
      expect(sent(presidio)).toHaveLength(1);
      expect(flagReads).toHaveLength(0);
      expect(scopeReads).toHaveLength(0);
    });
  });

  describe("given an allowlisted organization and a long batch", () => {
    /** @scenario "A long batch skips the model and goes to Presidio" */
    it("sends a batch over 8,000 characters to Presidio and nothing to the model", async () => {
      const { analysis, presidio, memoryModel, sent } = setup();
      presidio.answerWith({
        kind: "detected",
        results: [
          { status: "processed", raw_response: { anonymized: "<PERSON>" } },
          { status: "skipped" },
        ],
      });

      const cleared = await analysis.clearPresidio({
        texts: ["a".repeat(5_000), "b".repeat(3_001)],
        piiRedactionLevel: "STRICT",
        resolvedPiiLevel: "strict",
        projectId: PROJECT_ID,
      });

      expect(cleared).toEqual(["[PERSON]", null]);
      expect(sent(memoryModel)).toHaveLength(0);
      expect(sent(presidio)).toHaveLength(1);
    });

    it("still sends a batch of exactly 8,000 characters to the model", async () => {
      const { analysis, presidio, memoryModel, sent } = setup();
      memoryModel.answerWith(anonymized("<PERSON>"));

      await analysis.clearPresidio({
        texts: ["a".repeat(8_000)],
        piiRedactionLevel: "STRICT",
        resolvedPiiLevel: "strict",
        projectId: PROJECT_ID,
      });

      expect(sent(memoryModel)).toHaveLength(1);
      expect(sent(presidio)).toHaveLength(0);
    });

    /** @scenario "Each PII redaction model call leaves one usage log line" */
    it("logs a long batch as too_long and counts it", async () => {
      const { analysis, presidio, fallbacks, usage } = setup();
      presidio.answerWith(anonymized("<PERSON>"));

      await analysis.clearPresidio({
        texts: ["a".repeat(8_001)],
        piiRedactionLevel: "STRICT",
        resolvedPiiLevel: "strict",
        projectId: PROJECT_ID,
      });

      expect(fallbacks).toEqual(["too_long"]);
      expect(usage.map((line) => line.fields)).toEqual([
        {
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          texts: 1,
          characters: 8_001,
          spansFound: 0,
          outcome: "too_long",
          durationMs: 0,
        },
      ]);
    });
  });

  describe("given a model that has just timed out", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /** Answers every Presidio batch, so a skipped or failed model call still clears. */
    function setupWith(turns: ModelTurn[]) {
      vi.useFakeTimers();
      const model = scriptedModel(turns);
      const context = setup({
        model: model.channel,
        modelTimeoutMs: PII_REDACTION_MODEL_TIMEOUT_MS,
      });
      for (let i = 0; i < 10; i++) context.presidio.answerWith(anonymized("call <PERSON>"));
      return { ...context, model };
    }

    /** One batch that waits out the full time cap on the model before Presidio answers it. */
    async function timeOut(analysis: PiiAnalysisService) {
      const cleared = analysis.clearPresidio(strictBatch());
      await vi.advanceTimersByTimeAsync(PII_REDACTION_MODEL_TIMEOUT_MS);
      await expect(cleared).resolves.toEqual(["call [PERSON]"]);
    }

    /** @scenario "A model that times out is skipped for two minutes" */
    it("sends the next batches to Presidio without calling the model", async () => {
      const { analysis, model, presidio, sent, fallbacks, usage } = setupWith([{ kind: "hang" }]);

      await timeOut(analysis);
      await expect(analysis.clearPresidio(strictBatch())).resolves.toEqual(["call [PERSON]"]);
      await expect(analysis.clearPresidio(strictBatch())).resolves.toEqual(["call [PERSON]"]);

      expect(model.batches).toHaveLength(1);
      expect(sent(presidio)).toHaveLength(3);
      expect(fallbacks).toEqual(["timeout", "breaker_open", "breaker_open"]);
      expect(usage.map((line) => line.fields.outcome)).toEqual([
        "timeout",
        "breaker_open",
        "breaker_open",
      ]);
      expect(usage[1]).toEqual({
        level: "info",
        message: "PII redaction model call",
        fields: {
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          texts: 1,
          characters: 8,
          spansFound: 0,
          outcome: "breaker_open",
          durationMs: 0,
        },
      });
      expect(JSON.stringify(usage)).not.toContain("Ana");
    });

    /** @scenario "A model that times out is skipped for two minutes" */
    it("keeps skipping the model until the cool-down has passed", async () => {
      expect(PII_REDACTION_MODEL_BREAKER_COOLDOWN_MS).toBe(120_000);
      const { analysis, model } = setupWith([{ kind: "hang" }, { kind: "answer" }]);

      await timeOut(analysis);
      await vi.advanceTimersByTimeAsync(PII_REDACTION_MODEL_BREAKER_COOLDOWN_MS - 1);
      await analysis.clearPresidio(strictBatch());
      expect(model.batches).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1);
      await analysis.clearPresidio(strictBatch());
      expect(model.batches).toHaveLength(2);
    });

    /** @scenario "A model that times out is skipped for two minutes" */
    it("lets one batch try the model after the cool-down while the others skip it", async () => {
      const { analysis, model, fallbacks } = setupWith([
        { kind: "hang" },
        { kind: "answer", afterMs: 1_000 },
      ]);

      await timeOut(analysis);
      await vi.advanceTimersByTimeAsync(PII_REDACTION_MODEL_BREAKER_COOLDOWN_MS);
      const batches = [
        analysis.clearPresidio(strictBatch()),
        analysis.clearPresidio(strictBatch()),
        analysis.clearPresidio(strictBatch()),
      ];
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(Promise.all(batches)).resolves.toEqual([
        ["call [PERSON]"],
        ["call [PERSON]"],
        ["call [PERSON]"],
      ]);

      expect(model.batches).toHaveLength(2);
      expect(fallbacks).toEqual(["timeout", "breaker_open", "breaker_open"]);
    });

    /** @scenario "A model that times out is skipped for two minutes" */
    it("sends every batch to the model again once the try succeeds", async () => {
      const { analysis, model, fallbacks } = setupWith([{ kind: "hang" }]);

      await timeOut(analysis);
      await vi.advanceTimersByTimeAsync(PII_REDACTION_MODEL_BREAKER_COOLDOWN_MS);
      await analysis.clearPresidio(strictBatch());
      await analysis.clearPresidio(strictBatch());
      await analysis.clearPresidio(strictBatch());

      expect(model.batches).toHaveLength(4);
      expect(fallbacks).toEqual(["timeout"]);
    });

    /** @scenario "A model that times out is skipped for two minutes" */
    it("skips the model for another cool-down when the try times out too", async () => {
      const { analysis, model, fallbacks } = setupWith([{ kind: "hang" }, { kind: "hang" }]);

      await timeOut(analysis);
      await vi.advanceTimersByTimeAsync(PII_REDACTION_MODEL_BREAKER_COOLDOWN_MS);
      await timeOut(analysis);
      await vi.advanceTimersByTimeAsync(PII_REDACTION_MODEL_BREAKER_COOLDOWN_MS - 1);
      await analysis.clearPresidio(strictBatch());
      expect(model.batches).toHaveLength(2);

      await vi.advanceTimersByTimeAsync(1);
      await analysis.clearPresidio(strictBatch());
      expect(model.batches).toHaveLength(3);
      expect(fallbacks).toEqual(["timeout", "timeout", "breaker_open"]);
    });

    it("tries the model again a cool-down after a try that never settles", async () => {
      const { analysis, model } = setupWith([{ kind: "hang" }, { kind: "stall" }]);

      await timeOut(analysis);
      await vi.advanceTimersByTimeAsync(PII_REDACTION_MODEL_BREAKER_COOLDOWN_MS);
      void analysis.clearPresidio(strictBatch());
      await vi.advanceTimersByTimeAsync(PII_REDACTION_MODEL_BREAKER_COOLDOWN_MS - 1);
      await analysis.clearPresidio(strictBatch());
      expect(model.batches).toHaveLength(2);

      await vi.advanceTimersByTimeAsync(1);
      await analysis.clearPresidio(strictBatch());
      expect(model.batches).toHaveLength(3);
    });

    /** @scenario "A model that times out is skipped for two minutes" */
    it("keeps skipping when a batch sent before the timeout answers late", async () => {
      const { analysis, model, fallbacks } = setupWith([
        { kind: "hang" },
        { kind: "answer", afterMs: 45_000 },
      ]);

      const timedOut = analysis.clearPresidio(strictBatch());
      await vi.advanceTimersByTimeAsync(20_000);
      const late = analysis.clearPresidio(strictBatch());
      await vi.advanceTimersByTimeAsync(30_000);
      await timedOut;
      await vi.advanceTimersByTimeAsync(15_000);
      await late;
      await analysis.clearPresidio(strictBatch());

      expect(model.batches).toHaveLength(2);
      expect(fallbacks).toEqual(["timeout", "breaker_open"]);
    });

    /** @scenario "A model that times out is skipped for two minutes" */
    it("skips the model after it is throttled, counting the throttle", async () => {
      const { analysis, model, fallbacks, usage } = setupWith([{ kind: "throttle" }]);

      await analysis.clearPresidio(strictBatch());
      await analysis.clearPresidio(strictBatch());

      expect(model.batches).toHaveLength(1);
      expect(fallbacks).toEqual(["throttled", "breaker_open"]);
      expect(usage[0]!.fields).toMatchObject({
        outcome: "throttled",
        errorName: "TooManyRequestsException",
      });
    });

    /** @scenario "A model that times out is skipped for two minutes" */
    it("still calls the model after a refusal, which is not a timeout", async () => {
      const { analysis, model, fallbacks } = setupWith([{ kind: "refuse" }]);

      await analysis.clearPresidio(strictBatch());
      await analysis.clearPresidio(strictBatch());

      expect(model.batches).toHaveLength(2);
      expect(fallbacks).toEqual(["error"]);
    });

    /** @scenario "A model that times out is skipped for two minutes" */
    it("closes after a try the model refuses, since it answered in time", async () => {
      const { analysis, model, fallbacks } = setupWith([{ kind: "hang" }, { kind: "refuse" }]);

      await timeOut(analysis);
      await vi.advanceTimersByTimeAsync(PII_REDACTION_MODEL_BREAKER_COOLDOWN_MS);
      await analysis.clearPresidio(strictBatch());
      await analysis.clearPresidio(strictBatch());

      expect(model.batches).toHaveLength(3);
      expect(fallbacks).toEqual(["timeout", "error"]);
    });

    it("logs a long batch as too_long, not breaker_open, while the model is skipped", async () => {
      const { analysis, fallbacks } = setupWith([{ kind: "hang" }]);

      await timeOut(analysis);
      await analysis.clearPresidio({
        texts: ["a".repeat(8_001)],
        piiRedactionLevel: "STRICT",
        resolvedPiiLevel: "strict",
        projectId: PROJECT_ID,
      });

      expect(fallbacks).toEqual(["timeout", "too_long"]);
    });
  });
});
