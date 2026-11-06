import type { PiiDetectionOutcome, PiiDetectionRequest } from "@langwatch/evaluation-contract";
import type { FeatureFlagApi, FeatureFlagTarget } from "@langwatch/feature-flag-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import {
  dataPrivacyTestGraph,
  dataPrivacyTestPlacement,
} from "../../app/__tests__/data-privacy.fixture.ts";
import { MemoryGoogleDlpChannel } from "../../channels/memory/memory.google-dlp.channel.ts";
import { MemoryPresidioChannel } from "../../channels/memory/memory.presidio.channel.ts";
import type { PresidioChannel } from "../../channels/presidio.channel.ts";
import type { DataPrivacyProjectScopeRepository } from "../../repositories/data-privacy-project-scope.repository.ts";
import { MemoryDataPrivacyProjectScopeRepository } from "../../repositories/memory/memory.data-privacy-project-scope.repository.ts";
import { DataPrivacyProjectScopeService } from "../data-privacy-project-scope.service.ts";
import { GoogleDlpRedactionService } from "../google-dlp-redaction.service.ts";
import { PiiAnalysisService } from "../pii-analysis.service.ts";
import { PiiRedactionModelService } from "../pii-redaction-model.service.ts";
import { PiiRedactionPolicyService } from "../pii-redaction-policy.service.ts";
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

function setup({
  modelConfigured = true,
  allowlisted = true,
  flagFails = false,
  model,
  modelTimeoutMs = 60_000,
}: {
  modelConfigured?: boolean;
  allowlisted?: boolean;
  flagFails?: boolean;
  model?: PresidioChannel;
  modelTimeoutMs?: number;
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
  const repository: DataPrivacyProjectScopeRepository = {
    find: (input) => {
      scopeReads.push(input.projectId);
      return placements.find(input);
    },
  };

  const analysis = PiiAnalysisService.create({
    presidio: PresidioRedactionService.create({ presidio, metrics, timeoutMs: 60_000 }),
    model: PiiRedactionModelService.create({
      model: PresidioRedactionService.create({
        presidio: model ?? memoryModel,
        metrics,
        timeoutMs: modelTimeoutMs,
        method: "pii_redaction_model",
      }),
      featureFlags,
      scopes: DataPrivacyProjectScopeService.create({ repository }),
    }),
    dlp: GoogleDlpRedactionService.create({ dlp, disabled: false, metrics }),
  });

  /** The batches each service was actually sent, leaving out the empty configured probe. */
  const sent = (channel: MemoryPresidioChannel) =>
    channel.batches.filter((batch) => batch.texts.length > 0);

  return { analysis, presidio, memoryModel, dlp, flagReads, scopeReads, sent };
}

const strictBatch = (
  { projectId }: { projectId: string | undefined } = { projectId: PROJECT_ID },
) => ({
  texts: ["call Ana"],
  piiRedactionLevel: "STRICT" as const,
  projectId,
});

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
});
