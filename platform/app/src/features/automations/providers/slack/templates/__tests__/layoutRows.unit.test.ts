import { describe, expect, it } from "vitest";
import { buildLayoutGroups, otherCadenceOf } from "../layoutRows";
import type { SlackBlockKitTemplateId } from "../registry";

const build = (
  overrides: Partial<Parameters<typeof buildLayoutGroups>[0]> = {},
) =>
  buildLayoutGroups({
    groupingCadence: "immediate",
    kind: "trace",
    deliveryMethod: "webhook",
    currentSource: "",
    defaultId: "trace_alert_compact",
    ...overrides,
  });

const idsOf = (groups: ReturnType<typeof build>): SlackBlockKitTemplateId[] =>
  groups.flatMap((group) => group.rows.map((row) => row.option.id));

const rowFor = (groups: ReturnType<typeof build>, id: string) =>
  groups.flatMap((group) => group.rows).find((row) => row.option.id === id);

describe("buildLayoutGroups", () => {
  describe("given a trace automation", () => {
    it("leads with the grouped cadence and follows with the other one", () => {
      const groups = build({ groupingCadence: "digest" });

      expect(groups.map((group) => group.cadence)).toEqual([
        "digest",
        "immediate",
      ]);
      expect(groups.map((group) => group.heading)).toEqual([
        "One digest message",
        "One message per trace",
      ]);
    });

    it("marks only the layouts of the other cadence as cross-cadence", () => {
      const groups = build();

      expect(rowFor(groups, "trace_alert_compact")?.fromOtherCadence).toBe(
        false,
      );
      expect(rowFor(groups, "digest_compact")?.fromOtherCadence).toBe(true);
    });

    // The default is computed against the draft's LIVE cadence, so between a
    // cross-cadence pick and the regroup it can name a layout sitting in the
    // other group. Badging it there would put "Default" on a layout the
    // automation is not on the cadence for.
    it("badges the default only when it sits in the leading group", () => {
      const inLeadingGroup = build({ defaultId: "trace_alert_compact" });
      const inOtherGroup = build({ defaultId: "digest_inline_rich" });

      expect(rowFor(inLeadingGroup, "trace_alert_compact")?.isDefault).toBe(
        true,
      );
      expect(rowFor(inOtherGroup, "digest_inline_rich")?.isDefault).toBe(false);
    });

    /** @scenario "The richer templates are offered only for a bot connection" */
    it("locks a layout that leads with a gated block, on a webhook only", () => {
      const onWebhook = build({ deliveryMethod: "webhook" });
      const onBot = build({ deliveryMethod: "bot" });

      // "Eval failure banner" leads with a gated `alert` block; "Compact
      // notice" leads with an allowlisted one.
      expect(rowFor(onWebhook, "eval_failure_rich")?.locked).toBe(true);
      expect(rowFor(onWebhook, "trace_alert_compact")?.locked).toBe(false);
      expect(rowFor(onBot, "eval_failure_rich")?.locked).toBe(false);
    });

    it("selects the layout whose source the draft carries, and nothing for a custom one", () => {
      const oneLiner = rowFor(build(), "trace_alert_one_liner")!.option;
      const onPreset = build({ currentSource: oneLiner.source });
      const onCustom = build({ currentSource: "{{ hand written }}" });

      expect(rowFor(onPreset, "trace_alert_one_liner")?.isSelected).toBe(true);
      expect(rowFor(onPreset, "trace_alert_compact")?.isSelected).toBe(false);
      expect(
        onCustom.flatMap((group) => group.rows).some((row) => row.isSelected),
      ).toBe(false);
    });
  });

  describe("given a graph alert", () => {
    it("offers one unheaded group, because an alert has no second cadence", () => {
      const groups = build({ kind: "graphAlert" });

      expect(groups).toHaveLength(1);
      expect(groups[0]?.heading).toBeUndefined();
    });
  });

  describe("given a report", () => {
    // Every report layout fits both cadences, so a naive other-cadence group
    // would repeat all of them under a second heading.
    it("offers each layout once, in one unheaded group", () => {
      const groups = build({ kind: "report", reportSource: "traceQuery" });

      expect(groups).toHaveLength(1);
      expect(groups[0]?.heading).toBeUndefined();
      expect(idsOf(groups)).toEqual([
        "report_table",
        "report_digest",
        "report_summary_card",
      ]);
    });
  });

  // Keyboard navigation walks the flattened rows and finds the highlighted one
  // by id, so a repeated id would make Arrow keys jump back to the first copy.
  describe("given any draft the picker can render", () => {
    it("never repeats a layout across the groups", () => {
      const cases = [
        build(),
        build({ groupingCadence: "digest" }),
        build({ kind: "graphAlert" }),
        build({ kind: "report", reportSource: "traceQuery" }),
        build({ kind: "report", reportSource: "customGraph" }),
      ];

      for (const groups of cases) {
        const ids = idsOf(groups);
        expect(new Set(ids).size).toBe(ids.length);
      }
    });
  });
});

describe("otherCadenceOf", () => {
  it("pairs the two cadences a trace automation can run on", () => {
    expect(otherCadenceOf("digest")).toBe("immediate");
    expect(otherCadenceOf("immediate")).toBe("digest");
  });
});
