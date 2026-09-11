// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The Anthropic composer's three adapter settings, and the one place each of
 * them is allowed to be written down.
 *
 * All three used to be asked the same way — a picker, or a free-text box with
 * the domain in a hint — and all three were the wrong shape for the question.
 * `report` has two states and a right answer for almost everyone, which is a
 * toggle. `bucketWidth` has one correct answer for every screen that reads the
 * data, so it is no longer asked at all. `startingAt` is a date, and the word
 * for it on the form is now the admin's word rather than ours.
 *
 * Two risks survive that rework and are what most of this file measures.
 *
 * The toggle stores "cost" and "usage", not "true" and "false", because the
 * adapter's schema is unchanged and every source already saved holds those
 * words. A switch that wrote the boolean strings would open every existing
 * usage source in the on position and save it as cost on the next unrelated
 * edit, so the two values a switch reads and writes are declared on the field.
 *
 * The bucket width is withdrawn from the form without being withdrawn from the
 * sources already reading at one. It stays declared and hidden rather than
 * deleted: the seed and the edit-save path both walk the declared fields, so a
 * field the form stops declaring is a field the edit path silently drops — an
 * hourly source migrated to daily by opening its drawer and changing its name.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { anthropicAdminPullConfigSchema } from "../../../services/pullers/anthropicAdmin.puller";
import {
  ANTHROPIC_BUCKET_WIDTHS,
  buildAnthropicAdminPullConfig,
  type ComposerState,
  dateInputValue,
  defaultParserValues,
  fieldControl,
  missingRequiredParserFieldKeys,
  PARSER_FIELDS,
  reconcileParserValues,
  seedComposerParserConfig,
  switchFieldIsOn,
  switchReadOnlyLabel,
  visibleParserFields,
} from "../inventory";

const fieldFor = (key: string) => {
  const field = PARSER_FIELDS.anthropic_admin.find((f) => f.key === key);
  if (!field) throw new Error(`no anthropic_admin field named ${key}`);
  return field;
};

const switchControlFor = (key: string, values: Record<string, string>) => {
  const control = fieldControl({ field: fieldFor(key), values });
  if (control.kind !== "switch") {
    throw new Error(`${key} is rendered as ${control.kind}, not a switch`);
  }
  return control;
};

const composerWith = (parserConfig: Record<string, string>): ComposerState => ({
  sourceType: "anthropic_admin",
  name: "Anthropic org",
  description: "",
  parserConfig: { credentialsToken: "sk-ant-admin-test", ...parserConfig },
  pullSchedule: "0 * * * *",
  ottlStatements: [],
  // A pull source carries no conversations, so it never offers a
  // destination (ADR-088 Decision 8).
  traceProjectId: null,
});

/** What the report toggle holds when it is on, and when it is off. */
const reportWhenOn = () => switchControlFor("report", {}).onValue;
const reportWhenOff = () => switchControlFor("report", {}).offValue;

afterEach(() => {
  vi.useRealTimers();
});

describe("Anthropic composer controls", () => {
  describe("the report toggle", () => {
    // @scenario "The report is one toggle named for what the admin gets"
    it("is a toggle, named for what the admin gets rather than for a report", () => {
      expect(switchControlFor("report", {}).kind).toBe("switch");
      expect(fieldFor("report").label).toBe("Use Anthropic's reported cost");
    });

    // @scenario "The toggle explains both sides in plain words"
    it("explains both sides, and that a source records one of them only", () => {
      // A toggle's label can only name one side. Everything the old two-entry
      // picker conveyed by listing both reports now has to be in the hint, or
      // the admin turning it off is not told what they are turning it on to.
      const hint = fieldFor("report").hint ?? "";

      expect(hint).toMatch(/spend/i);
      expect(hint).toMatch(/token|counts/i);
      expect(hint).toMatch(/price/i);
      expect(hint).toMatch(/one report|never both|not both/i);
    });

    // @scenario "A new source opens on the provider's own cost figure"
    it("opens on the cost report, through the path the drawer actually seeds", () => {
      // Off the seeding path rather than off the field definition: a default
      // that exists only on the FieldDef and is never seeded shows one answer
      // and hands the builder another.
      expect(defaultParserValues("anthropic_admin").report).toBe("cost");
      expect(switchControlFor("report", {}).defaultOn).toBe(true);

      const built = buildAnthropicAdminPullConfig(
        composerWith(defaultParserValues("anthropic_admin")),
      );

      expect(built).toMatchObject({ report: "cost" });
    });

    // @scenario "Turning the toggle off records the usage report"
    it("records the usage report when it is turned off", () => {
      // The values the switch reads and writes are the adapter's own words.
      // `anthropicAdmin.puller.ts` is untouched by this rework and every
      // source already saved holds one of these two strings.
      expect(reportWhenOn()).toBe("cost");
      expect(reportWhenOff()).toBe("usage");

      const built = buildAnthropicAdminPullConfig(
        composerWith({ report: reportWhenOff() }),
      );

      expect(built).toMatchObject({ report: "usage" });
    });

    // @scenario "A source saved on the usage report opens with the toggle off"
    it("opens off for a source saved on the usage report", () => {
      const seeded = seedComposerParserConfig({
        sourceType: "anthropic_admin",
        storedParserConfig: { report: "usage", bucketWidth: "1d" },
      });
      const control = switchControlFor("report", seeded);

      // The whole reason the two values are declared. Read as "true"/"false",
      // "usage" is neither, so the field would fall back to its default and
      // open ON — and the next unrelated edit would save this source as cost.
      expect(
        switchFieldIsOn({
          value: seeded.report,
          defaultOn: control.defaultOn,
          onValue: control.onValue,
          offValue: control.offValue,
        }),
      ).toBe(false);

      expect(
        buildAnthropicAdminPullConfig(
          composerWith({ ...seeded, credentialsToken: "sk-ant-admin-test" }),
        ),
      ).toMatchObject({ report: "usage" });
    });

    // @scenario "The report can no longer be left unanswered"
    it("has no empty state left to refuse a save over", () => {
      // The picker carried an entry with no value so a cleared field could be
      // refused rather than quietly refilled. A toggle is one of two states,
      // so the field is never empty and the refusal has nothing to fire on.
      expect(
        missingRequiredParserFieldKeys({
          sourceType: "anthropic_admin",
          values: {},
        }),
      ).not.toContain("report");

      // Which is only safe while the seed really does answer it. A required
      // flag removed from a field the form can still leave blank is how a
      // save gets refused with nothing marked on the form.
      expect(defaultParserValues("anthropic_admin").report).toBeTruthy();
    });

    // @scenario "A locked report names the report rather than a switch position"
    it("names the report it holds when it is locked, rather than a position", () => {
      const control = switchControlFor("report", {});

      // "Off" is the position of a control the admin can no longer see. The
      // question a locked field has to answer is which report this source
      // records.
      expect(switchReadOnlyLabel({ control, value: "usage" })).toBe(
        "Usage report",
      );
      expect(switchReadOnlyLabel({ control, value: "cost" })).toBe(
        "Cost report",
      );
    });

    // @scenario "A locked report names the report rather than a switch position"
    it("still reads On and Off for a switch that declares no labels of its own", () => {
      // The report is the only switch on any composer whose two states have
      // names of their own. Every other one is a plain on/off, and the labels
      // are optional precisely so those are left alone.
      const plain = fieldControl({
        field: {
          key: "x",
          label: "x",
          // Required on every field, and meaningless on a switch — which has
          // no empty state for a placeholder to describe.
          placeholder: "",
          control: "switch",
          defaultOn: true,
        },
        values: {},
      });
      if (plain.kind !== "switch") throw new Error("expected a switch");

      expect(switchReadOnlyLabel({ control: plain, value: "true" })).toBe("On");
      expect(switchReadOnlyLabel({ control: plain, value: "false" })).toBe(
        "Off",
      );
    });
  });

  describe("the bucket width, which is no longer asked", () => {
    // @scenario "The form offers no bucket width, on either report"
    it("appears on neither report", () => {
      for (const report of [reportWhenOn(), reportWhenOff()]) {
        const shown = visibleParserFields({
          sourceType: "anthropic_admin",
          values: { report },
        }).map((f) => f.key);

        expect(shown).not.toContain("bucketWidth");
      }
    });

    // @scenario "The form offers no bucket width, on either report"
    it("is still declared, because the edit path only carries what is declared", () => {
      // Deleting the field would look like the same change and would not be.
      // `seedComposerParserConfig` and `buildEditedParserConfig` both walk
      // `PARSER_FIELDS`, so an undeclared width is never seeded from storage
      // and is stripped from the stored config on the next save.
      expect(fieldFor("bucketWidth").hidden).toBe(true);
      expect(
        seedComposerParserConfig({
          sourceType: "anthropic_admin",
          storedParserConfig: { report: "usage", bucketWidth: "1h" },
        }).bucketWidth,
      ).toBe("1h");
    });

    // @scenario "The form offers no bucket width, on either report"
    it("knows the same widths the adapter schema accepts, and no others", () => {
      // Still a projection of the schema even though nothing offers a choice
      // any more: the list is what a held width is measured against before it
      // is carried forward, so drift would either drop a width the adapter
      // honours or preserve one it has stopped accepting.
      expect([...ANTHROPIC_BUCKET_WIDTHS]).toEqual([
        ...anthropicAdminPullConfigSchema.shape.bucketWidth.removeDefault()
          .options,
      ]);
    });

    // @scenario "A usage source is written down as daily"
    it("is written down as daily on a usage source that holds nothing", () => {
      const built = buildAnthropicAdminPullConfig(
        composerWith({ report: reportWhenOff() }),
      );

      // Explicit rather than omitted. The adapter defaults to daily too, but a
      // stored config that says nothing cannot be told from one saved before
      // the field existed.
      expect(built).toMatchObject({ bucketWidth: "1d" });
      expect(
        anthropicAdminPullConfigSchema.shape.bucketWidth.parse(undefined),
      ).toBe("1d");
    });

    // @scenario "A cost source carries no bucket width"
    it("is left out entirely on a cost source", () => {
      const built = buildAnthropicAdminPullConfig(
        composerWith({ report: reportWhenOn() }),
      );

      expect(built).not.toBeNull();
      expect(built).not.toHaveProperty("bucketWidth");
    });

    // @scenario "A source already reading hourly keeps reading hourly"
    it("keeps the hourly width of a source edited for something else", () => {
      // Through the whole edit path rather than the builder alone. Seeding
      // has to carry the stored width and reconcile has to leave it alone;
      // either one dropping it is a migration performed by opening a drawer.
      const seeded = seedComposerParserConfig({
        sourceType: "anthropic_admin",
        storedParserConfig: {
          credentialsToken: "sk-ant-admin-test",
          report: "usage",
          bucketWidth: "1h",
        },
      });
      const reconciled = reconcileParserValues({
        sourceType: "anthropic_admin",
        values: seeded,
      });

      expect(reconciled.bucketWidth).toBe("1h");
      expect(
        buildAnthropicAdminPullConfig(
          composerWith({
            ...reconciled,
            credentialsToken: "sk-ant-admin-test",
          }),
        ),
      ).toMatchObject({ bucketWidth: "1h" });
    });

    // @scenario "A source already reading hourly keeps reading hourly"
    it("carries forward only a width the adapter would still accept", () => {
      // Retention reaches as far as the schema and no further. A `2h` that
      // arrived from somewhere other than this form is not preserved — and
      // must not refuse the save either, since nothing on the form shows it.
      const built = buildAnthropicAdminPullConfig(
        composerWith({ report: reportWhenOff(), bucketWidth: "2h" }),
      );

      expect(built).toMatchObject({ bucketWidth: "1d" });
    });

    // @scenario "An hourly width on a cost source is dropped rather than refusing the save"
    it("drops an hourly width held on a cost source instead of refusing", () => {
      // The width was never in effect on a cost source — the puller pins that
      // report to daily — so there is nothing to preserve. Refusing the save
      // would block it over a field the form does not show.
      const built = buildAnthropicAdminPullConfig(
        composerWith({ report: reportWhenOn(), bucketWidth: "1h" }),
      );

      expect(built).not.toBeNull();
      expect(built).not.toHaveProperty("bucketWidth");
    });

    // @scenario "An hourly width on a cost source is dropped rather than refusing the save"
    it("is left alone by reconcile, which no longer has a control to match it against", () => {
      // Reconcile clears a held value its own picker stopped offering. With
      // nothing offered at all, a width on a usage source would be cleared on
      // the first keystroke after the drawer opened.
      expect(
        reconcileParserValues({
          sourceType: "anthropic_admin",
          values: { report: "usage", bucketWidth: "1h" },
        }).bucketWidth,
      ).toBe("1h");
    });
  });

  describe("the date history is read from", () => {
    // @scenario "The backfill start asks in plain words when to start reading"
    it("asks when to start reading, on a calendar", () => {
      const field = fieldFor("startingAt");

      expect(field.label).toBe("Read history from");
      expect(fieldControl({ field, values: {} }).kind).toBe("date");

      const hint = field.hint ?? "";
      expect(hint).toMatch(/first day/i);
      expect(hint).toMatch(/forward|where the last/i);
      expect(hint).toMatch(/clear/i);
    });

    // @scenario "A new Anthropic source proposes six months of history"
    it("proposes midnight UTC six months back on a new source", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-15T10:30:00.000Z"));

      expect(defaultParserValues("anthropic_admin").startingAt).toBe(
        "2026-03-15T00:00:00.000Z",
      );
    });

    // @scenario "Editing shows the stored date rather than proposing a new one"
    it("shows the stored day on an edit, and is not re-seeded", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-15T10:30:00.000Z"));

      const seeded = seedComposerParserConfig({
        sourceType: "anthropic_admin",
        storedParserConfig: {
          report: "usage",
          startingAt: "2026-08-01T00:00:00.000Z",
        },
      });

      expect(seeded.startingAt).toBe("2026-08-01T00:00:00.000Z");
      expect(dateInputValue(seeded.startingAt ?? "")).toBe("2026-08-01");
    });

    // @scenario "Clearing the proposed date still means the adapter's own default"
    it("carries no start at all once the admin clears it", () => {
      const built = buildAnthropicAdminPullConfig(
        composerWith({ report: reportWhenOff(), startingAt: "" }),
      );

      expect(built).not.toBeNull();
      expect(built).not.toHaveProperty("startingAt");
    });

    // @scenario "Showing an instant on a date control does not rewrite it"
    it("keeps an untouched instant intact through a save", () => {
      // The display truncates to the calendar date; the held value must not.
      expect(dateInputValue("2026-08-01T13:45:00.000Z")).toBe("2026-08-01");
      expect(
        buildAnthropicAdminPullConfig(
          composerWith({
            report: reportWhenOff(),
            startingAt: "2026-08-01T13:45:00.000Z",
          }),
        ),
      ).toMatchObject({ startingAt: "2026-08-01T13:45:00.000Z" });
    });

    // @scenario "A picked date is still normalized to an instant before saving"
    it("normalizes a freshly picked date to an instant", () => {
      expect(
        buildAnthropicAdminPullConfig(
          composerWith({ report: reportWhenOff(), startingAt: "2026-08-01" }),
        ),
      ).toMatchObject({ startingAt: "2026-08-01T00:00:00.000Z" });
    });
  });
});
