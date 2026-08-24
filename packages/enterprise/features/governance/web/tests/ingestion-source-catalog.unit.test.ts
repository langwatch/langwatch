// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The ingestion-source catalog is the single derivation both the Add source
 * menu and the composer read: which types exist, which vendor icon each
 * carries, which of the two customer-facing groups it sits under, and which
 * types the org's plan has locked. Spec:
 * specs/ai-gateway/governance/ingestion-sources.feature
 */
import { describe, expect, it } from "vitest";
import {
  gatedSourceTypeOptions,
  groupForMode,
  SOURCE_GROUP_META,
  SOURCE_TYPE_OPTIONS,
} from "../src/ingestion-source-catalog";

describe("given the ingestion-source catalog", () => {
  describe("when a non-enterprise plan gates the options", () => {
    /** @scenario "The composer and the menu share one plan gate" */
    it("locks every type except Generic OpenTelemetry", () => {
      const options = gatedSourceTypeOptions({ isEnterprise: false });
      const unlocked = options.filter((o) => !o.locked).map((o) => o.value);
      expect(unlocked).toEqual(["otel_generic"]);
      expect(options.length).toBe(SOURCE_TYPE_OPTIONS.length);
    });

    /** @scenario "The composer and the menu share one plan gate" */
    it("keeps every option visible so the locked ones can say why", () => {
      const options = gatedSourceTypeOptions({ isEnterprise: false });
      expect(options.map((o) => o.value)).toEqual(
        SOURCE_TYPE_OPTIONS.map((o) => o.value),
      );
    });
  });

  describe("when an enterprise plan gates the options", () => {
    /** @scenario "The composer and the menu share one plan gate" */
    it("locks nothing", () => {
      const options = gatedSourceTypeOptions({ isEnterprise: true });
      expect(options.every((o) => !o.locked)).toBe(true);
    });
  });

  describe("when the modes fold into customer-facing groups", () => {
    /** @scenario "The configured-source list groups under the same two headings" */
    it("sends push to the real-time group and pull plus s3 to the scheduled group", () => {
      expect(groupForMode("push")).toBe("realtime");
      expect(groupForMode("pull")).toBe("scheduled");
      expect(groupForMode("s3")).toBe("scheduled");
    });

    /** @scenario "The configured-source list groups under the same two headings" */
    it("titles exactly two groups in plain language", () => {
      expect(Object.keys(SOURCE_GROUP_META).sort()).toEqual([
        "realtime",
        "scheduled",
      ]);
      expect(SOURCE_GROUP_META.realtime.title).toBe("Real-time streams");
      expect(SOURCE_GROUP_META.scheduled.title).toBe("Synced on a schedule");
    });

    /** @scenario "Add source menu lists every type by vendor, grouped in plain language" */
    it("keeps the internal mode words out of every group heading and blurb", () => {
      for (const meta of Object.values(SOURCE_GROUP_META)) {
        expect(`${meta.title} ${meta.blurb}`).not.toMatch(
          /\b(push|pull|s3)\b/i,
        );
      }
    });
  });
});
