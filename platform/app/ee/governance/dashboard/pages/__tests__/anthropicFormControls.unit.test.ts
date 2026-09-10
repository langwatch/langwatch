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

    // @scenario "The bucket width is daily whichever report is chosen"
    it("still refuses a finer width an older source was saved with", () => {
      // The picker no longer offers `1h`, but an edit form opening on a source
      // saved when it did still seeds one, and the builder is the checkpoint
      // that decides what reaches the adapter. On a usage source it is a width
      // the schema accepts, so it builds rather than blocking the admin out of
      // their own source.
      const built = buildAnthropicAdminPullConfig(
        composerWith({ report: "usage", bucketWidth: "1h" }),
      ) as Record<string, unknown>;

      expect(built.bucketWidth).toBe("1h");
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
