import { describe, expect, it } from "vitest";

import type { PiiAnalysisMetrics } from "../../app/data-privacy.members.ts";
import { HttpGoogleDlpChannel } from "../../channels/http/http.google-dlp.channel.ts";
import { MemoryGoogleDlpChannel } from "../../channels/memory/memory.google-dlp.channel.ts";
import { GoogleDlpRedactionService } from "../google-dlp-redaction.service.ts";

class RecordingMetrics implements PiiAnalysisMetrics {
  readonly calls: string[] = [];
  analysisCalled(method: string): void {
    this.calls.push(method);
  }
  analysisObserved(): void {}
  analysisFinished(): void {}
}

function setup(disabled = false) {
  const dlp = MemoryGoogleDlpChannel.create();
  const metrics = new RecordingMetrics();
  return { dlp, metrics, service: GoogleDlpRedactionService.create({ dlp, disabled, metrics }) };
}

describe("GoogleDlpRedactionService", () => {
  describe("given Google DLP is turned off", () => {
    /** @scenario "The DLP fallback refuses by name when it is unavailable" */
    it("refuses naming LANGWATCH_DISABLE_GOOGLE_DLP before inspecting", async () => {
      const { dlp, service } = setup(true);

      await expect(
        service.clear({ text: "ops@example.com", piiRedactionLevel: "STRICT" }),
      ).rejects.toThrow("LANGWATCH_DISABLE_GOOGLE_DLP");
      expect(dlp.inspections).toHaveLength(0);
    });
  });

  describe("given no usable service account", () => {
    /** @scenario "The DLP fallback refuses by name when it is unavailable" */
    it.each([undefined, "not json", '{"client_email":"a@b"}'])(
      "refuses naming GOOGLE_APPLICATION_CREDENTIALS for %s",
      async (credential) => {
        const service = GoogleDlpRedactionService.create({
          dlp: HttpGoogleDlpChannel.create({ credential }),
          disabled: false,
          metrics: new RecordingMetrics(),
        });

        await expect(
          service.clear({ text: "ops@example.com", piiRedactionLevel: "STRICT" }),
        ).rejects.toThrow("GOOGLE_APPLICATION_CREDENTIALS");
      },
    );
  });

  describe("given a credentialed DLP", () => {
    /** @scenario "The DLP fallback masks a finding and honours an exception" */
    it("replaces a finding's range and asks for the level's info types", async () => {
      const { dlp, metrics, service } = setup();
      dlp.answerWith([{ start: 5, end: 14, quote: "Ana Silva" }]);

      const clearing = await service.clear({
        text: "call Ana Silva",
        piiRedactionLevel: "ESSENTIAL",
      });

      expect(clearing).toEqual({ kind: "redacted", text: "call [REDACTED]" });
      expect(dlp.inspections[0]!.infoTypes).not.toContain("PERSON_NAME");
      expect(metrics.calls).toEqual(["google_dlp"]);
    });

    /** @scenario "The DLP fallback masks a finding and honours an exception" */
    it("leaves a finding a policy exception covers entirely as it was", async () => {
      const { dlp, service } = setup();
      dlp.answerWith([{ start: 0, end: 15, quote: "ops@example.com" }]);

      const clearing = await service.clear({
        text: "ops@example.com",
        piiRedactionLevel: "STRICT",
        exceptPatterns: ["ops@example\\.com"],
      });

      expect(clearing).toEqual({ kind: "unchanged" });
    });

    it("converts codepoint offsets past a surrogate pair and keeps text past the budget", async () => {
      const { dlp, service } = setup();
      dlp.answerWith([{ start: 2, end: 5, quote: "Ana" }]);
      const tail = "x".repeat(10);

      const clearing = await service.clear({
        text: `😀 Ana${" ".repeat(250_000 - 6)}${tail}`,
        piiRedactionLevel: "STRICT",
      });

      expect(clearing.kind === "redacted" && clearing.text.startsWith("😀 [REDACTED] ")).toBe(true);
      expect(clearing.kind === "redacted" && clearing.text.endsWith(` ${tail}`)).toBe(true);
      expect(dlp.inspections[0]!.text).toHaveLength(250_000);
    });
  });

  describe("given a model name with a misread first name and a phone number", () => {
    const value = "claude-sonnet-4-6+12345678901";
    const nameAndPhone = [
      { start: 0, end: 6, quote: "claude", infoType: "FIRST_NAME" },
      { start: 18, end: 29, quote: "12345678901", infoType: "PHONE_NUMBER" },
    ];

    it("masks only the phone number when the value is flagged", async () => {
      const { dlp, service } = setup();
      dlp.answerWith(nameAndPhone);

      const clearing = await service.clear({
        text: value,
        piiRedactionLevel: "STRICT",
        spareNamesAndPlaces: true,
      });

      expect(clearing).toEqual({ kind: "redacted", text: "claude-sonnet-4-6+[REDACTED]" });
    });

    /** @scenario "A spared name an exception keeps still blocks an overlapping finding on the fallback detector" */
    it("still protects a spared name an exception keeps from an overlapping finding", async () => {
      const { dlp, service } = setup();
      dlp.answerWith([
        { start: 0, end: 6, quote: "claude", infoType: "FIRST_NAME" },
        { start: 3, end: 29, quote: undefined, infoType: "PHONE_NUMBER" },
      ]);

      const clearing = await service.clear({
        text: value,
        piiRedactionLevel: "STRICT",
        exceptPatterns: ["claude"],
        spareNamesAndPlaces: true,
      });

      expect(clearing).toEqual({ kind: "redacted", text: "claude[REDACTED]" });
    });

    it("masks the name too when the value is not flagged", async () => {
      const { dlp, service } = setup();
      dlp.answerWith(nameAndPhone);

      const clearing = await service.clear({ text: value, piiRedactionLevel: "STRICT" });

      expect(clearing).toEqual({ kind: "redacted", text: "[REDACTED]-sonnet-4-6+[REDACTED]" });
    });
  });
});
