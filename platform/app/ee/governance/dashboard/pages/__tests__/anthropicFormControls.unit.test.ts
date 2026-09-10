// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The Anthropic composer's three closed-domain fields, and the one place their
 * domains are allowed to be written down.
 *
 * `report` and `bucketWidth` are enums the puller already declares; `startingAt`
 * is an instant. Rendering them as free text meant the domain lived in a hint,
 * and the admin found out they had mistyped it from a rejected save. Rendering
 * them as pickers moves the domain into the form — which is only an improvement
 * while the form's list and the adapter's schema still say the same thing, so
 * the option lists are asserted against `anthropicAdminPullConfigSchema` rather
 * than against a second hand-written copy of themselves.
 *
 * The startingAt field carries the subtler risk. Every value that reaches
 * storage has been through `normalizeStartingAt`, which returns an ISO instant
 * — so the edit form always seeds an instant, never a calendar date, and a
 * plain `<input type="date">` handed one renders blank. Blank on an edit form
 * reads as "no backfill start configured", and saving from there would drop a
 * setting the admin never touched. The date control therefore shows the
 * instant's calendar date and leaves the underlying value alone until the
 * admin actually picks a new one.
 */

import { describe, expect, it } from "vitest";
import { anthropicAdminPullConfigSchema } from "../../../services/pullers/anthropicAdmin.puller";
import {
  ANTHROPIC_BUCKET_WIDTHS,
  buildAnthropicAdminPullConfig,
  type ComposerState,
  dateInputValue,
  defaultParserValues,
  fieldControl,
  PARSER_FIELDS,
  reconcileParserValues,
  seedComposerParserConfig,
} from "../inventory";

const fieldFor = (key: string) => {
  const field = PARSER_FIELDS.anthropic_admin.find((f) => f.key === key);
  if (!field) throw new Error(`no anthropic_admin field named ${key}`);
  return field;
};

const selectOptionsFor = (key: string, values: Record<string, string>) => {
  const control = fieldControl({ field: fieldFor(key), values });
  if (control.kind !== "select") {
    throw new Error(`${key} is rendered as ${control.kind}, not a select`);
  }
  return control.options;
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

describe("Anthropic composer controls", () => {
  describe("the report field", () => {
    // @scenario "The report offers the two reports that exist and nothing else"
    it("offers exactly the reports the adapter schema declares", () => {
      const offered = selectOptionsFor("report", {})
        .map((o) => o.value)
        .filter((v) => v !== "");

      expect(offered).toEqual([
        ...anthropicAdminPullConfigSchema.shape.report.options,
      ]);
    });

    // @scenario "The report opens on the one almost every organization wants"
    it("opens on the cost report rather than on nothing", () => {
      // Through the seeding path the drawer actually uses, not off the field
      // definition: a default that only exists on the FieldDef and is never
      // seeded shows an answer the builder is not handed.
      expect(defaultParserValues("anthropic_admin").report).toBe("cost");

      // And it has to be a report that is really offered, or the picker
      // displays a value with no matching option and shows nothing at all.
      expect(selectOptionsFor("report", {}).map((o) => o.value)).toContain(
        "cost",
      );
    });

    // @scenario "The report opens on the one almost every organization wants"
    it("still offers an entry carrying no value, so the choice can be cleared", () => {
      const options = selectOptionsFor("report", {});

      // The default answers the field; it does not lock it. Clearing the
      // picker has to remain possible, and the form then refuses the save and
      // marks the field rather than quietly reinstating cost.
      expect(options[0]?.value).toBe("");
      expect(fieldFor("report").required).toBe(true);
    });
  });

  describe("the bucket width field", () => {
    // @scenario "The bucket width is daily whichever report is chosen"
    it("knows the same widths the adapter schema accepts, and no others", () => {
      // `ANTHROPIC_BUCKET_WIDTHS` is what the form will hand back to an old
      // source and what `validBucketWidth` measures a stored width against.
      // Both readings are only correct while the list is a projection of the
      // schema — let it drift and the form either refuses a width the adapter
      // would have honoured, or keeps offering one the adapter has dropped.
      expect([...ANTHROPIC_BUCKET_WIDTHS]).toEqual([
        ...anthropicAdminPullConfigSchema.shape.bucketWidth.removeDefault()
          .options,
      ]);
    });

    // @scenario "The bucket width is daily whichever report is chosen"
    it("offers the daily entry alone on a usage source", () => {
      const options = selectOptionsFor("bucketWidth", { report: "usage" });

      expect(options.map((o) => o.value)).toEqual([""]);
      expect(options[0]?.label).toContain("daily");
    });

    // @scenario "The bucket width is daily whichever report is chosen"
    it("says daily because the adapter's own default is daily", () => {
      // The entry carries no value, so what the source is actually read at is
      // whatever the schema defaults to. If that default ever moves off `1d`,
      // the form's label becomes a claim nothing backs — which is the drift
      // this pins, and the reason the label is not just asserted against
      // itself.
      const bucketWidth =
        anthropicAdminPullConfigSchema.shape.bucketWidth.parse(undefined);

      expect(bucketWidth).toBe("1d");
      expect(
        selectOptionsFor("bucketWidth", { report: "usage" })[0]?.label,
      ).toBe("1d — daily");
    });

    // @scenario "A source already reading hourly keeps reading hourly"
    it("keeps offering the width an existing usage source is read at", () => {
      // Through the whole edit path, not the builder alone. The builder was
      // never the risk: `reconcileParserValues` drops any held value the
      // picker does not offer, so a picker offering daily alone would have
      // cleared this source's width before the builder ever saw it — a
      // migration to daily performed by opening the drawer.
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
        selectOptionsFor("bucketWidth", reconciled).map((o) => o.value),
      ).toEqual(["", "1h"]);
      // Built with the token supplied rather than with the seeded values as
      // they stand: seeding deliberately returns a blank secret, so every edit
      // of this source needs the token retyped whatever the width does (#7777).
      // That is a separate problem and not what this test is measuring.
      expect(
        (
          buildAnthropicAdminPullConfig(
            composerWith({
              ...reconciled,
              credentialsToken: "sk-ant-admin-test",
            }),
          ) as Record<string, unknown>
        ).bucketWidth,
      ).toBe("1h");
    });

    // @scenario "A source already reading hourly keeps reading hourly"
    it("offers daily beside it, so the admin can still move off the finer width", () => {
      const options = selectOptionsFor("bucketWidth", {
        report: "usage",
        bucketWidth: "1h",
      });

      // The retention is not a lock-in. Daily stays first and still carries no
      // value, so choosing it is how a source leaves the finer width behind.
      expect(options[0]?.value).toBe("");
      expect(options[0]?.label).toBe("1d — daily");
      expect(options[1]?.label).toBe("1h — hourly");
    });

    // @scenario "A width the cost report would reject is not kept either"
    it("keeps nothing on a cost source, whose width was never in effect", () => {
      const options = selectOptionsFor("bucketWidth", {
        report: "cost",
        bucketWidth: "1h",
      });

      // The puller pins the cost report to daily and ignores the setting, so
      // the stored `1h` was doing nothing. Offering it back would show the
      // admin a control with no effect, and the builder refuses it anyway.
      expect(options.map((o) => o.value)).toEqual([""]);
      expect(
        buildAnthropicAdminPullConfig(
          composerWith({ report: "cost", bucketWidth: "1h" }),
        ),
      ).toBeNull();
    });

    // @scenario "Clearing the report to re-pick it does not cost the source its width"
    it("keeps the width while the report field sits empty between picks", () => {
      // The report picker keeps an empty entry on purpose, so clearing it is a
      // state the admin passes through rather than an answer. Reconcile runs on
      // every keystroke, so a picker that read "not usage" as "retire the
      // width" would take `1h` away the moment the field went blank — and
      // choosing usage again would not bring it back.
      const cleared = reconcileParserValues({
        sourceType: "anthropic_admin",
        values: { report: "", bucketWidth: "1h" },
      });

      expect(cleared.bucketWidth).toBe("1h");
      expect(
        selectOptionsFor("bucketWidth", cleared).map((o) => o.value),
      ).toEqual(["", "1h"]);

      // And it survives the round trip back to usage.
      expect(
        reconcileParserValues({
          sourceType: "anthropic_admin",
          values: { ...cleared, report: "usage" },
        }).bucketWidth,
      ).toBe("1h");
    });

    // @scenario "Clearing the report to re-pick it does not cost the source its width"
    it("still refuses to save from the state it is holding the width through", () => {
      // Retaining the width is a form concern only. An empty report is not a
      // configuration, and the builder turns it down before it reads a width,
      // so nothing can reach the adapter from here.
      expect(
        buildAnthropicAdminPullConfig(
          composerWith({ report: "", bucketWidth: "1h" }),
        ),
      ).toBeNull();
    });

    // @scenario "The bucket width is daily whichever report is chosen"
    it("refuses a width no version of the form ever offered", () => {
      // Retention reaches only as far as the schema does. A `2h` that arrived
      // from somewhere other than this form is neither offered back nor built.
      expect(
        selectOptionsFor("bucketWidth", {
          report: "usage",
          bucketWidth: "2h",
        }).map((o) => o.value),
      ).toEqual([""]);
      expect(
        buildAnthropicAdminPullConfig(
          composerWith({ report: "usage", bucketWidth: "2h" }),
        ),
      ).toBeNull();
    });

    // @scenario "The cost report offers no width to choose between"
    it("collapses to the default entry on a cost source", () => {
      const options = selectOptionsFor("bucketWidth", { report: "cost" });

      expect(options.map((o) => o.value)).toEqual([""]);
      expect(
        fieldControl({
          field: fieldFor("bucketWidth"),
          values: { report: "cost" },
        }),
      ).toMatchObject({ hint: expect.stringContaining("always daily") });
    });

    // @scenario "Switching to the cost report drops a width already chosen"
    it("clears a width the cost report would refuse", () => {
      const reconciled = reconcileParserValues({
        sourceType: "anthropic_admin",
        values: { report: "cost", bucketWidth: "1h" },
      });

      expect(reconciled.bucketWidth).toBe("");
      expect(
        buildAnthropicAdminPullConfig(composerWith(reconciled)),
      ).not.toBeNull();
    });

    // @scenario "Leaving the bucket width alone still means the adapter default"
    it("submits no bucket width when the default entry is left in place", () => {
      const built = buildAnthropicAdminPullConfig(
        composerWith({ report: "usage", bucketWidth: "" }),
      );

      expect(built).not.toBeNull();
      expect(built).not.toHaveProperty("bucketWidth");
    });
  });

  describe("the backfill start field", () => {
    // @scenario "The backfill start is a date control"
    it("is a date control rather than free text", () => {
      expect(
        fieldControl({ field: fieldFor("startingAt"), values: {} }).kind,
      ).toBe("date");
    });

    // @scenario "A stored instant is shown as its calendar date"
    it("shows a seeded instant as the date a date input can display", () => {
      const seeded = seedComposerParserConfig({
        sourceType: "anthropic_admin",
        storedParserConfig: {
          report: "usage",
          startingAt: "2026-08-01T00:00:00.000Z",
        },
      });

      expect(dateInputValue(seeded.startingAt ?? "")).toBe("2026-08-01");
    });

    // @scenario "Showing an instant on a date control does not rewrite it"
    it("keeps an untouched instant intact through a save", () => {
      const built = buildAnthropicAdminPullConfig(
        composerWith({
          report: "usage",
          startingAt: "2026-08-01T13:45:00.000Z",
        }),
      );

      // The display truncates to the calendar date; the value must not.
      expect(dateInputValue("2026-08-01T13:45:00.000Z")).toBe("2026-08-01");
      expect(built).toMatchObject({ startingAt: "2026-08-01T13:45:00.000Z" });
    });

    // @scenario "A picked date is still normalized to an instant before saving"
    it("normalizes a freshly picked date to an instant", () => {
      const built = buildAnthropicAdminPullConfig(
        composerWith({ report: "usage", startingAt: "2026-08-01" }),
      );

      expect(built).toMatchObject({ startingAt: "2026-08-01T00:00:00.000Z" });
    });
  });
});
