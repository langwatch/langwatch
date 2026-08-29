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
  SOURCE_TYPE_LABEL,
  SOURCE_TYPE_OPTIONS,
} from "../ingestion-source-catalog";

/** What the menu should offer: everything the catalog still sells. */
const offerable = SOURCE_TYPE_OPTIONS.filter((o) => !o.deprecated);

describe("given the ingestion-source catalog", () => {
  describe("when a non-enterprise plan gates the options", () => {
    /** @scenario "The composer and the menu share one plan gate" */
    it("locks every type except Generic OpenTelemetry", () => {
      const options = gatedSourceTypeOptions({ isEnterprise: false });
      const unlocked = options.filter((o) => !o.locked).map((o) => o.value);
      expect(unlocked).toEqual(["otel_generic"]);
      expect(options.length).toBe(offerable.length);
    });

    /**
     * "Every option" means every option still on offer. A retired type is
     * dropped rather than locked: locked is a sales message about what
     * Enterprise unlocks, and a retired source is not something to sell.
     *
     * @scenario "The composer and the menu share one plan gate"
     */
    it("keeps every offerable option visible so the locked ones can say why", () => {
      const options = gatedSourceTypeOptions({ isEnterprise: false });
      expect(options.map((o) => o.value)).toEqual(offerable.map((o) => o.value));
    });
  });

  describe("when a source type has been retired", () => {
    /** @scenario "The old Copilot source can no longer be chosen" */
    it("is not offered on any plan", () => {
      for (const isEnterprise of [true, false]) {
        const offered = gatedSourceTypeOptions({ isEnterprise }).map((o) => o.value);
        expect(offered).not.toContain("copilot_studio");
      }
    });

    /**
     * The entry stays in the catalog on purpose. `SOURCE_TYPE_LABEL` is built
     * from this list and read without a fallback where a configured source's
     * type is displayed, so deleting the entry turns an existing source's
     * name into a blank — and the completeness guard in the catalog would
     * stop the build first.
     */
    /** @scenario "Sources already configured on the old type still display" */
    it("still resolves a label for sources already configured on it", () => {
      expect(SOURCE_TYPE_LABEL.copilot_studio).toBeTruthy();
      expect(SOURCE_TYPE_OPTIONS.some((o) => o.value === "copilot_studio")).toBe(true);
    });
  });

  describe("when an enterprise plan gates the options", () => {
    /** @scenario "The composer and the menu share one plan gate" */
    it("locks nothing", () => {
      const options = gatedSourceTypeOptions({ isEnterprise: true });
      expect(options.every((o) => !o.locked)).toBe(true);
    });
  });

  describe("when a vendor's spend can only be read once", () => {
    /** @scenario "Adding a second source for the same organization warns the admin" */
    it("says in the OpenAI Admin blurb that a second source counts the spend twice", () => {
      const option = SOURCE_TYPE_OPTIONS.find((o) => o.value === "openai_admin");

      // The warning is the copy, not a guard: nothing refuses the second
      // source, here or on any other vendor, so the admin reads it before
      // choosing rather than being stopped after.
      expect(option?.blurb).toMatch(/only ever create one per organization/i);
      expect(option?.blurb).toMatch(/count the same spend twice/i);
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
      expect(Object.keys(SOURCE_GROUP_META).sort()).toEqual(["realtime", "scheduled"]);
      expect(SOURCE_GROUP_META.realtime.title).toBe("Real-time streams");
      expect(SOURCE_GROUP_META.scheduled.title).toBe("Synced on a schedule");
    });

    /** @scenario "Add source menu lists every type by vendor, grouped in plain language" */
    it("keeps the internal mode words out of every group heading and blurb", () => {
      for (const meta of Object.values(SOURCE_GROUP_META)) {
        expect(`${meta.title} ${meta.blurb}`).not.toMatch(/\b(push|pull|s3)\b/i);
      }
    });
  });
});
