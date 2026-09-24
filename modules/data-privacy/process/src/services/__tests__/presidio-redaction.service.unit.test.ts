import { createApiFixture } from "@langwatch/api-fixture";
import {
  type EvaluationApi,
  LangevalsPiiDetectionError,
  type PiiDetectionOutcome,
  type PiiDetectionRequest,
} from "@langwatch/evaluation-contract";
import { describe, expect, it } from "vitest";

import type { PiiAnalysisMetrics, PiiAnalysisOutcome } from "../../app/data-privacy.members.ts";
import { PresidioRedactionService } from "../presidio-redaction.service.ts";

class RecordingMetrics implements PiiAnalysisMetrics {
  readonly called: string[] = [];
  readonly finished: PiiAnalysisOutcome[] = [];
  observed = 0;
  analysisCalled(method: string): void {
    this.called.push(method);
  }
  analysisObserved(): void {
    this.observed += 1;
  }
  analysisFinished(outcome: PiiAnalysisOutcome): void {
    this.finished.push(outcome);
  }
}

function setup(answer: (input: PiiDetectionRequest) => Promise<PiiDetectionOutcome>) {
  const requests: PiiDetectionRequest[] = [];
  const metrics = new RecordingMetrics();
  const evaluation = createApiFixture<EvaluationApi>({
    detectPii: (input) => {
      requests.push(input);
      return answer(input);
    },
  });
  const service = PresidioRedactionService.create({ evaluation, metrics, timeoutMs: 60_000 });
  return { requests, metrics, service };
}

describe("PresidioRedactionService", () => {
  describe("when it sends a batch", () => {
    /** @scenario "The analysis request is the one the service expects" */
    it("asks for the level's entities, scans within the budget and puts the rest back", async () => {
      const tail = "y".repeat(5);
      const { requests, metrics, service } = setup(async () => ({
        kind: "detected",
        results: [
          { status: "processed", raw_response: { anonymized: "hi <PERSON>" } },
          { status: "skipped" },
        ],
      }));

      const cleared = await service.clear({
        texts: [`hi Ana${" ".repeat(250_000 - 6)}${tail}`, "nothing"],
        piiRedactionLevel: "ESSENTIAL",
        projectId: "project-1",
      });

      expect(cleared).toEqual([`hi [PERSON]${tail}`, null]);
      expect(requests[0]!.projectId).toBe("project-1");
      expect(requests[0]!.texts[0]).toHaveLength(250_000);
      expect(requests[0]!.entities).toContain("US_SSN");
      expect(requests[0]!.entities).not.toContain("PERSON");
      expect(metrics.called).toEqual(["presidio"]);
      expect(metrics.finished).toEqual(["processed", "skipped"]);
    });

    /** @scenario "The analysis request is the one the service expects" */
    it("sends a custom level's chosen entities instead of the level's list", async () => {
      const { requests, service } = setup(async (input) => ({
        kind: "detected",
        results: input.texts.map(() => ({ status: "skipped" as const })),
      }));

      await service.clear({ texts: [], piiRedactionLevel: "STRICT", entities: ["PERSON"] });
      await service.clear({ texts: ["a"], piiRedactionLevel: "STRICT", entities: ["PERSON"] });

      expect(requests).toHaveLength(1);
      expect(requests[0]!.entities).toEqual(["PERSON"]);
    });

    it("counts a refused batch as an error and throws it on", async () => {
      const { metrics, service } = setup(async () => {
        throw new LangevalsPiiDetectionError("presidio exploded");
      });

      await expect(
        service.clear({ texts: ["a"], piiRedactionLevel: "STRICT" }),
      ).rejects.toBeInstanceOf(LangevalsPiiDetectionError);
      expect(metrics.finished).toEqual(["error"]);
      expect(metrics.observed).toBe(1);
    });
  });

  describe("when asked whether the analysis service is configured", () => {
    /** @scenario "Whether the analysis service is reachable is asked of evaluation, once" */
    it("asks once with an empty batch and remembers the answer", async () => {
      const { requests, service } = setup(async () => ({ kind: "not_configured" }));

      expect(await service.isConfigured()).toBe(false);
      expect(await service.isConfigured()).toBe(false);
      expect(requests).toHaveLength(1);
      expect(requests[0]!.texts).toEqual([]);
    });

    /** @scenario "Whether the analysis service is reachable is asked of evaluation, once" */
    it("asks again after an answer failed", async () => {
      let calls = 0;
      const { service } = setup(async () => {
        calls += 1;
        if (calls === 1) throw new Error("evaluation not ready");
        return { kind: "detected", results: [] };
      });

      await expect(service.isConfigured()).rejects.toThrow("evaluation not ready");
      expect(await service.isConfigured()).toBe(true);
    });
  });
});
