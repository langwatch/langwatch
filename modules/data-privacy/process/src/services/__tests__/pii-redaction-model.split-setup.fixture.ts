import { DATA_PRIVACY_PRESIDIO_TIMEOUT_MS } from "@langwatch/data-privacy-contract";
import type { PiiRedactionSpendPricedEventData } from "@langwatch/data-privacy-contract/pii-redaction-spend";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { PiiDetectionOutcome } from "@langwatch/evaluation-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { ConcurrencyLimiter } from "@langwatch/limiter";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { vi } from "vitest";

import {
  dataPrivacyTestGraph,
  dataPrivacyTestPlacement,
} from "../../app/__tests__/data-privacy.fixture.ts";
import { MemoryGoogleDlpChannel } from "../../channels/memory/memory.google-dlp.channel.ts";
import { MemoryPresidioChannel } from "../../channels/memory/memory.presidio.channel.ts";
import type { PresidioChannel, SplittingPresidioChannel } from "../../channels/presidio.channel.ts";
import { MemoryDataPrivacyProjectScopeRepository } from "../../repositories/memory/memory.data-privacy-project-scope.repository.ts";
import {
  type ModelCallContext,
  PII_REDACTION_MODEL_SPLIT_FLAG,
  PII_REDACTION_MODEL_TIMEOUT_MS,
} from "../../rules/pii-redaction-model.rules.ts";
import { piiRedactionRequestIdKey } from "../../rules/pii-redaction-spend.rules.ts";
import { planSpan, type SplitCall } from "../../rules/pii-redaction-split.rules.ts";
import { DataPrivacyProjectScopeService } from "../data-privacy-project-scope.service.ts";
import { GoogleDlpRedactionService } from "../google-dlp-redaction.service.ts";
import type { PiiRedactionModelFallbackReason } from "../pii-analysis-metrics-otel.service.ts";
import { PiiAnalysisService } from "../pii-analysis.service.ts";
import {
  type PiiRedactionModelUsage,
  PiiRedactionModelService,
} from "../pii-redaction-model.service.ts";
import { PiiRedactionSpendService } from "../pii-redaction-spend.service.ts";
import { PresidioRedactionService } from "../presidio-redaction.service.ts";
import { type FakeTurn, fakePiiModel, type PlantedValue } from "./pii-redaction-split.fixture.ts";

export const PROJECT_ID = dataPrivacyTestGraph.projectId;
export const ORGANIZATION_ID = dataPrivacyTestGraph.organizationId;
export const KEY = piiRedactionRequestIdKey("test-key-pepper");
export const PRESIDIO_MASK = "presidio cleared it";
export const metrics = {
  analysisCalled: () => void 0,
  analysisObserved: () => void 0,
  analysisFinished: () => void 0,
};

/** Presidio's answer for a batch of `count` texts: each one cleared to {@link PRESIDIO_MASK}. */
export const presidioAnswer = (count: number): PiiDetectionOutcome => ({
  kind: "detected",
  results: Array.from({ length: count }, () => ({
    status: "processed" as const,
    raw_response: { anonymized: PRESIDIO_MASK },
  })),
});

/** The calls the planner makes for `texts` when splitting is on. */
export function planSpanCalls(texts: readonly string[]): readonly SplitCall[] {
  const plan = planSpan({ texts, splitting: true });
  return plan.kind === "split" ? plan.calls : [];
}

export function setup({
  planted = [],
  turns = [],
  split = true,
  splitFlag = true,
  slots,
}: {
  planted?: readonly PlantedValue[];
  turns?: FakeTurn[];
  /** Whether the one model channel can split: a Lambda channel can, an HTTP one cannot. */
  split?: boolean;
  /** The organization's split flag (ADR-207 decision 9). */
  splitFlag?: boolean;
  slots?: ConcurrencyLimiter;
} = {}) {
  const presidio = MemoryPresidioChannel.create({ endpoint: "http://langevals:5562" });
  const single = fakePiiModel({ planted });
  const splitModel = fakePiiModel({ planted, turns });
  const fallbacks: PiiRedactionModelFallbackReason[] = [];
  const usage: PiiRedactionModelUsage[] = [];
  const priced: PiiRedactionSpendPricedEventData[] = [];
  const contexts: ModelCallContext[] = [];
  let splitFlagReads = 0;
  // The one model channel; the two fakes only keep each context's calls and turns apart.
  const splitting: SplittingPresidioChannel = {
    splits: true,
    detect: (input, options) => {
      const context = options?.context ?? "single";
      if (input.texts.length > 0) contexts.push(context);
      return { single, split: splitModel }[context].channel.detect(input);
    },
  };
  const channel: PresidioChannel = split ? splitting : single.channel;

  const analysis = PiiAnalysisService.create({
    presidio: PresidioRedactionService.create({
      presidio,
      metrics,
      timeoutMs: DATA_PRIVACY_PRESIDIO_TIMEOUT_MS,
    }),
    model: PiiRedactionModelService.create({
      model: PresidioRedactionService.create({
        presidio: channel,
        metrics,
        timeoutMs: PII_REDACTION_MODEL_TIMEOUT_MS,
        method: "pii_redaction_model",
      }),
      splitSlots: slots,
      featureFlags: createApiFixture<FeatureFlagApi>({
        isEnabled: async (key) => {
          if (key !== PII_REDACTION_MODEL_SPLIT_FLAG) return true;
          splitFlagReads++;
          return splitFlag;
        },
      }),
      scopes: DataPrivacyProjectScopeService.create({
        repository: MemoryDataPrivacyProjectScopeRepository.create({
          projects: [dataPrivacyTestPlacement()],
        }),
      }),
      selfHosted: false,
      entitlements: createApiFixture<EntitlementApi>({}),
      spend: PiiRedactionSpendService.create({
        selfHosted: false,
        requestIdKey: KEY,
        featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled: async () => false }),
        recordSpendPriced: async (fact) => {
          priced.push(fact);
        },
      }),
      metrics: { modelFellBack: (reason) => fallbacks.push(reason) },
      log: {
        info: (fields) => usage.push(fields),
        warn: (fields) => usage.push(fields),
      },
      now: () => Date.now(),
    }),
    dlp: GoogleDlpRedactionService.create({
      dlp: MemoryGoogleDlpChannel.create(),
      disabled: false,
      metrics,
    }),
  });

  const clear = (
    texts: string[],
    extra: { spareNamesAndPlaces?: boolean[]; recordKey?: string } = {},
  ) =>
    analysis.clearPresidio({
      texts,
      piiRedactionLevel: "STRICT",
      effectivePiiLevel: "strict",
      projectId: PROJECT_ID,
      ...extra,
    });
  const presidioCalls = () => presidio.batches.filter((batch) => batch.texts.length > 0);

  const flagReads = () => splitFlagReads;
  return {
    clear,
    presidio,
    presidioCalls,
    single,
    splitModel,
    contexts,
    flagReads,
    fallbacks,
    usage,
    priced,
  };
}

/** Lets every settled promise run its callbacks, without moving the clock. */
export const flush = () => vi.advanceTimersByTimeAsync(0);

/** Where each call's texts sit in `text`: every sent piece located, in order. */
export function piecesOf({ text, calls }: { text: string; calls: readonly string[][] }) {
  return calls.flat().map((piece) => {
    const start = text.indexOf(piece);
    return { start, end: start + piece.length };
  });
}
