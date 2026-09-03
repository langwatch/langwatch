// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What the edit form shows, and what it declines to offer.
 *
 * These are the pure decisions taken before a single field is rendered:
 * whether this source type can be edited at all, which of its adapter fields
 * are shown but locked, how each field is labelled, and what the form is
 * seeded with when it opens. Getting one wrong is quiet — the form simply
 * offers a setting that cannot take effect, or hides one that can.
 */

import { describe, expect, it } from "vitest";
import { anthropicAdminPullConfigSchema } from "@langwatch/enterprise-governance-contract";
import {
  buildAnthropicAdminPullConfig,
  isBackfillStartLocked,
  isEditablePullSource,
  isEditSaveBlocked,
  lockedParserKeys,
  parserFieldPresentation,
  seedComposerParserConfig,
  seedPullSchedule,
} from "../governance-inventory.screen";
import { composer } from "./edit-pull-source-config.fixture";

describe("isEditablePullSource", () => {
  it("accepts a pull type the form knows how to rebuild", () => {
    expect(isEditablePullSource("anthropic_admin")).toBe(true);
  });

  it("refuses a pull type whose blank-secret meaning is ambiguous", () => {
    // Genie takes either a workspace token or a service-principal pair, so a
    // blank form there could mean "keep what is stored" or "switch auth
    // modes". Guessing locks an admin out of their own source.
    expect(isEditablePullSource("databricks_genie")).toBe(false);
  });

  it("refuses a push type, which has no pull config to rebuild", () => {
    expect(isEditablePullSource("otel_generic")).toBe(false);
  });

  it("refuses an absent type rather than throwing", () => {
    // A row written by a newer deploy reaches this page as a string that misses
    // every table; it must read as "not editable", not crash the drawer.
    expect(isEditablePullSource(undefined)).toBe(false);
  });
});

describe("isBackfillStartLocked", () => {
  /** @scenario "Backfill start is not editable once a usage cursor has moved" */
  it("locks the start for a usage source that has already pulled", () => {
    // The usage cursor never rewinds, so an edit here would silently do
    // nothing.
    expect(isBackfillStartLocked({ hasPulled: true, report: "usage" })).toBe(true);
  });

  /** @scenario "Backfill start stays editable on a cost source that has pulled" */
  it("leaves the start editable for a cost source that has already pulled", () => {
    // The cost cursor binds `startingAt` into its identity: moving the start
    // discards the cursor and re-reads the widened window. That is the repair
    // lever for wrong early figures, and locking it would remove it.
    expect(isBackfillStartLocked({ hasPulled: true, report: "cost" })).toBe(false);
  });

  /** @scenario "Backfill start is editable before the source has run" */
  it("leaves the start editable before the first pull, whatever the report", () => {
    expect(isBackfillStartLocked({ hasPulled: false, report: "usage" })).toBe(false);
    expect(isBackfillStartLocked({ hasPulled: false, report: "cost" })).toBe(false);
  });

  /** @scenario "A source whose stored configuration names no report is not locked" */
  it("does not lock a source whose config carries no report", () => {
    // Claiming immutability we cannot justify is the worse error: it sends an
    // admin to archive-and-recreate over a field that may well be editable.
    expect(isBackfillStartLocked({ hasPulled: true, report: undefined })).toBe(false);
  });
});

describe("isEditSaveBlocked", () => {
  it("blocks a blank name whatever the source type", () => {
    expect(
      isEditSaveBlocked({
        name: "   ",
        sourceType: "anthropic_admin",
        pullSchedule: "0 * * * *",
      }),
    ).toBe(true);
  });

  describe("given a pull source whose config this form rebuilds", () => {
    /** @scenario "An invalid cron expression is rejected at save time" */
    it("blocks a cron the cadence field has already marked invalid", () => {
      // The create drawer refuses this; the edit drawer used to accept the
      // click and let the server say no.
      expect(
        isEditSaveBlocked({
          name: "Anthropic org",
          sourceType: "anthropic_admin",
          pullSchedule: "not a cron",
        }),
      ).toBe(true);
    });

    it("allows a valid cron", () => {
      expect(
        isEditSaveBlocked({
          name: "Anthropic org",
          sourceType: "anthropic_admin",
          pullSchedule: "0 * * * *",
        }),
      ).toBe(false);
    });

    it("allows a blank cadence, which means the recommended schedule", () => {
      // Blank is not absent: it resolves to the default the field displays.
      expect(
        isEditSaveBlocked({
          name: "Anthropic org",
          sourceType: "anthropic_admin",
          pullSchedule: "",
        }),
      ).toBe(false);
    });
  });

  describe("given a source this form does not rebuild", () => {
    it("gates on the name alone", () => {
      // A push-mode source has no schedule for the field to have judged.
      expect(
        isEditSaveBlocked({
          name: "Webhook source",
          sourceType: undefined,
          pullSchedule: "not a cron",
        }),
      ).toBe(false);
    });
  });
});

describe("lockedParserKeys", () => {
  describe("given a source that has already pulled", () => {
    /**
     * The transition this guards is usage -> cost on a source with history.
     * The two reports price the same consumption — one by our own rate card,
     * one by Anthropic's invoice — so a source that has recorded `usage:*`
     * events and then starts recording `cost:*` events for the same period
     * has counted that spend twice. Nothing collides, which is exactly why
     * nothing catches it: the ids sit in different namespaces and both sets
     * survive.
     */
    /** @scenario "The report cannot be changed once a cursor exists" */
    it("locks the report on a usage source", () => {
      expect(lockedParserKeys({ hasPulled: true, report: "usage" })).toContain("report");
    });

    it("locks the report on a cost source too", () => {
      // The direction does not matter: cost -> usage double-counts the same
      // window just as usage -> cost does.
      expect(lockedParserKeys({ hasPulled: true, report: "cost" })).toContain("report");
    });

    /** @scenario "Backfill start is not editable once a usage cursor has moved" */
    it("still locks the backfill start on a usage source", () => {
      expect(lockedParserKeys({ hasPulled: true, report: "usage" })).toEqual(
        expect.arrayContaining(["startingAt", "report"]),
      );
    });

    /** @scenario "Backfill start stays editable on a cost source that has pulled" */
    it("leaves the cost source's backfill start editable", () => {
      // Locking it would remove the only lever for repairing wrong early
      // figures — see the sibling suite above.
      expect(lockedParserKeys({ hasPulled: true, report: "cost" })).not.toContain("startingAt");
    });
  });

  describe("given a source that has never pulled", () => {
    /** @scenario "Backfill start is editable before the source has run" */
    it("locks nothing", () => {
      expect(lockedParserKeys({ hasPulled: false, report: "usage" })).toEqual([]);
    });
  });

  describe("given a source whose config carries no report", () => {
    /** @scenario "A source whose stored configuration names no report is not locked" */
    it("locks nothing, rather than locking a field it cannot name", () => {
      expect(lockedParserKeys({ hasPulled: true, report: undefined })).toEqual([]);
    });
  });
});

describe("parserFieldPresentation", () => {
  const secretField = {
    key: "credentialsToken",
    label: "Admin API key",
    placeholder: "sk-ant-admin-...",
    hint: "Generate one in the Anthropic console.",
    required: true,
  };
  const plainField = {
    key: "report",
    label: "Report",
    placeholder: "usage",
    hint: "usage or cost",
    required: true,
  };

  /** @scenario "The edit form opens with the secret field empty" */
  it("on edit, tells the admin a blank secret keeps the current key", () => {
    const p = parserFieldPresentation({ field: secretField, mode: "edit" });

    expect(p.hint).toContain("Leave blank to keep the current key");
    expect(p.placeholder).toBe("Unchanged");
  });

  it("on edit, drops the required marker from a secret", () => {
    // A field that says "leave blank to keep the current key" while still
    // carrying a required marker is a form contradicting itself.
    expect(parserFieldPresentation({ field: secretField, mode: "edit" }).isRequired).toBe(false);
  });

  it("on create, keeps the secret mandatory and its own hint", () => {
    const p = parserFieldPresentation({ field: secretField, mode: "create" });

    expect(p.isRequired).toBe(true);
    expect(p.hint).toBe(secretField.hint);
    expect(p.placeholder).toBe(secretField.placeholder);
  });

  it("leaves a non-secret field identical in both modes", () => {
    expect(parserFieldPresentation({ field: plainField, mode: "edit" })).toEqual(
      parserFieldPresentation({ field: plainField, mode: "create" }),
    );
  });

  it("marks the DSL fields as multiline", () => {
    for (const key of ["parserDsl", "eventMappingDsl"]) {
      expect(
        parserFieldPresentation({
          field: { ...plainField, key },
          mode: "create",
        }).isMultiline,
      ).toBe(true);
    }
    expect(parserFieldPresentation({ field: plainField, mode: "create" }).isMultiline).toBe(false);
  });
});

describe("seedComposerParserConfig", () => {
  /** @scenario "The edit form opens with the secret field empty" */
  it("maps a stored config back onto the form fields", () => {
    const values = seedComposerParserConfig({
      sourceType: "anthropic_admin",
      storedParserConfig: {
        adapter: "anthropic_admin",
        report: "usage",
        bucketWidth: "1h",
        startingAt: "2026-08-01T00:00:00.000Z",
      },
    });

    expect(values.report).toBe("usage");
    expect(values.bucketWidth).toBe("1h");
    expect(values.startingAt).toBe("2026-08-01T00:00:00.000Z");
  });

  /** @scenario "The edit form opens with the secret field empty" */
  it("leaves every secret field blank rather than pre-filling it", () => {
    const values = seedComposerParserConfig({
      sourceType: "anthropic_admin",
      storedParserConfig: { report: "usage" },
    });

    expect(values.credentialsToken ?? "").toBe("");
  });

  /** @scenario "A stored envelope is never sent back to the server" */
  it("never surfaces a stored credential into the form, even if one reaches it", () => {
    // `toDto` strips `credentials` today, so this should be unreachable. It is
    // asserted anyway because the cost of that stripping regressing is the
    // form posting an envelope straight back into the server's replay refusal.
    const values = seedComposerParserConfig({
      sourceType: "anthropic_admin",
      storedParserConfig: {
        report: "usage",
        credentials: "enc:v1:deadbeef:cafe:0123",
      },
    });

    expect(Object.values(values).join(" ")).not.toContain("enc:v1:");
    expect(values.credentialsToken ?? "").toBe("");
  });

  /** @scenario "A stored envelope is never sent back to the server" */
  it("round-trips an untouched form without proposing any credential change", () => {
    const stored = {
      adapter: "anthropic_admin",
      report: "usage",
      bucketWidth: "1h",
      schedule: "0 * * * *",
    };
    const values = seedComposerParserConfig({
      sourceType: "anthropic_admin",
      storedParserConfig: stored,
    });

    const config = buildAnthropicAdminPullConfig(composer(values, "0 * * * *"), {
      shouldRequireCredentials: false,
    });

    expect(config).not.toHaveProperty("credentials");
    expect(anthropicAdminPullConfigSchema.parse(config).report).toBe("usage");
  });
});

describe("seedPullSchedule", () => {
  it("shows the column the scheduler runs on, not the parser config's copy", () => {
    // The two can disagree: `parserConfig.schedule` is the adapter's own copy,
    // written by the composer on create, while `pullSchedule` is the column
    // the lifecycle actually reads. Any write that touches one and not the
    // other — the update mutation takes `pullSchedule` on its own, and seeds
    // and migrations bypass both — leaves a row where seeding from the parser
    // config would show a cadence the source is not running on, and saving
    // would then write that stale value over the live one.
    expect(
      seedPullSchedule({
        pullSchedule: "0 */6 * * *",
        storedParserConfig: { schedule: "0 * * * *" },
      }),
    ).toBe("0 */6 * * *");
  });

  it("falls back to the parser config for a row whose column is empty", () => {
    // Not hypothetical: the column is nullable, and a null one reads as
    // `disable` to the lifecycle. Showing the adapter's copy is the better
    // answer than a blank box, which an admin reads as "no schedule set".
    expect(
      seedPullSchedule({
        pullSchedule: null,
        storedParserConfig: { schedule: "*/15 * * * *" },
      }),
    ).toBe("*/15 * * * *");
  });

  it("treats a whitespace-only column as absent", () => {
    expect(
      seedPullSchedule({
        pullSchedule: "   ",
        storedParserConfig: { schedule: "*/15 * * * *" },
      }),
    ).toBe("*/15 * * * *");
  });

  it("reports no schedule at all rather than inventing one", () => {
    // Blank is the cadence field's way of saying "use the recommended
    // schedule". Seeding a default here would make the field lie about what
    // is stored, and `buildEditSubmission` already resolves blank on save.
    expect(seedPullSchedule({ pullSchedule: null, storedParserConfig: {} })).toBe("");
  });

  it("ignores a non-string schedule in the parser config", () => {
    expect(
      seedPullSchedule({
        pullSchedule: null,
        storedParserConfig: { schedule: 42 },
      }),
    ).toBe("");
  });
});
