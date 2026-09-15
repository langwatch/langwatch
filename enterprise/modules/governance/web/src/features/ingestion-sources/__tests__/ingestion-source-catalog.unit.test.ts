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
} from "../model/ingestion-source-catalog.ts";

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

    /*
     * "Every option" means every option still on offer. A retired type is
     * dropped rather than locked: locked is a sales message about what
     * Enterprise unlocks, and a retired source is not something to sell.
     */
    /** @scenario "The composer and the menu share one plan gate" */
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

  describe("when a source type was offered before it worked", () => {
    /*
     * It was pickable with nothing reading it, so a source configured on it
     * stayed silent forever. It leaves the picker exactly the way the retired
     * Copilot type did.
     *
     * The Claude Enterprise Compliance type used to sit here beside it. Its
     * workspace key reaches its adapter now, so the sentence this block
     * asserts — that a source here would never deliver any data — became
     * false for it, and it is checked separately below on the footing it
     * actually has.
     */
    const NEVER_BUILT = ["openai_compliance"] as const;

    /** @scenario "A source type nothing reads can no longer be chosen" */
    it("is not offered on any plan", () => {
      for (const isEnterprise of [true, false]) {
        const offered = gatedSourceTypeOptions({ isEnterprise }).map(
          (o) => o.value,
        );
        // The guard against a vacuous pass: a filter that dropped everything
        // would satisfy the absences below while breaking the whole menu.
        expect(offered).toContain("otel_generic");
        expect(offered).toContain("openai_admin");
        for (const value of NEVER_BUILT) {
          expect(offered).not.toContain(value);
        }
      }
    });

    /** @scenario "Sources already configured on an unread type still display" */
    it("still resolves the display definition for sources configured on it", () => {
      for (const value of NEVER_BUILT) {
        // A configured row reads its name here without a fallback, so the
        // entry has to survive the hiding or the row's name goes blank.
        expect(SOURCE_TYPE_LABEL[value]).toBeTruthy();
        const option = SOURCE_TYPE_OPTIONS.find((o) => o.value === value);
        expect(option).toBeDefined();
        expect(option?.icon).toBeTruthy();
      }
    });

    /** @scenario "A source type nothing reads can no longer be chosen" */
    it("says in the blurb that the source is not available", () => {
      for (const value of NEVER_BUILT) {
        const option = SOURCE_TYPE_OPTIONS.find((o) => o.value === value);
        expect(option?.blurb).toMatch(/not available/i);
        // The old copy described a poller that was never written.
        expect(option?.blurb).not.toMatch(/polls|pulls/i);
      }
    });
  });

  describe("when a source type works but has not been run against a tenant", () => {
    it("stays out of the picker without claiming it could never deliver data", () => {
      const option = SOURCE_TYPE_OPTIONS.find(
        (o) => o.value === "claude_compliance",
      );
      for (const isEnterprise of [true, false]) {
        expect(
          gatedSourceTypeOptions({ isEnterprise }).map((o) => o.value),
        ).not.toContain("claude_compliance");
      }
      // The claim that made the old blurb true was the missing builder, and
      // the builder exists now. Repeating it here would be a page telling a
      // customer something we have fixed.
      expect(option?.blurb).not.toMatch(/never deliver/i);
      expect(option?.blurb).toMatch(/not offered/i);
      // Hidden, but not retired: retirement says no builder is owed, and one
      // was written. See the flag's doc comment on `SourceTypeOption`.
      expect(option?.deprecated).toBe(true);
      expect(option?.retired).toBeFalsy();
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
