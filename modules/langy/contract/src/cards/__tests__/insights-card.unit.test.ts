/**
 * The insights card, pinned: what Langy may write into it, and that it is one of the closed
 * list's presentation kinds, chosen by its `kind` alone.
 * @see modules/langy/specs/langy-insights-card.feature
 */
import { describe, expect, it } from "vitest";

import { salvageLangyDerivedCard } from "../../inline-channel/salvage.ts";
import {
  DERIVED_SAFE_CARD_KINDS,
  langyDerivedInsightsCardSchema,
  langyModelEmittedCardSchema,
} from "../derived-safe.ts";
import { CARD_PROBES } from "../registry.ts";
import {
  CARD_KINDS,
  CARD_SHAPE,
  INSIGHTS_CARD_MAX_FINDINGS,
  INSIGHTS_CARD_TONES,
  MEASURED_CARD_KINDS,
} from "../schemas.ts";

const finding = (overrides: Record<string, unknown> = {}) => ({
  title: "Checkout cost doubled",
  tone: "bad",
  body: "Cost on checkout rose from 41 to 96 dollars against the day before.",
  ...overrides,
});

const card = (overrides: Record<string, unknown> = {}) => ({
  kind: "insights",
  blockId: "daily-insights",
  findings: [finding()],
  ...overrides,
});

const accepts = (candidate: unknown) => langyDerivedInsightsCardSchema.validate(candidate);

describe("the insights card", () => {
  describe("given Langy's closed card list", () => {
    /** @scenario "The insights card is a presentation kind Langy may write" */
    it("lists insights as a presentation kind a model may emit, and no command produces", () => {
      expect(CARD_KINDS).toContain("insights");
      expect(CARD_SHAPE.insights).toBe("presentation");
      expect(DERIVED_SAFE_CARD_KINDS).toContain("insights");
      expect(MEASURED_CARD_KINDS as readonly string[]).not.toContain("insights");
    });

    /** @scenario "No command's result is promoted to an insights card" */
    it("is promoted to by no probe, so a command's payload never becomes findings", () => {
      expect(CARD_PROBES.map((probe) => probe.card as string)).not.toContain("insights");
    });
  });

  describe("given a card with every field a finding may hold", () => {
    /** @scenario "A finding holds its words, its verdict, its widget, its query, its key and what it renews" */
    it("is accepted, and its words are kept trimmed", () => {
      const parsed = langyDerivedInsightsCardSchema.parse(
        card({
          title: "Costs, 9 October",
          board: { id: "dashboard-1", name: "Costs" },
          window: { start: 1_760_000_000_000, end: 1_760_086_400_000, granularitySeconds: 3_600 },
          findings: [
            finding({
              title: "  Checkout cost doubled ",
              topic: "cost",
              validDays: 7,
              widgetId: "widget-cost",
              widgetName: "Cost per day",
              lwql: "SELECT sum(CostSum) FROM model_usage_by_minute",
              key: "checkout-cost-doubled",
              renews: "insight_1",
            }),
          ],
        }),
      );

      expect(parsed.findings[0]).toMatchObject({
        title: "Checkout cost doubled",
        tone: "bad",
        widgetId: "widget-cost",
        key: "checkout-cost-doubled",
        renews: "insight_1",
      });
    });

    it.each(INSIGHTS_CARD_TONES)("takes the tone %s", (tone) => {
      expect(accepts(card({ findings: [finding({ tone })] }))).toBe(true);
    });
  });

  describe("given a finding that proposes actions", () => {
    const action = (index: number) => ({ label: `Action ${index}`, prompt: `Do thing ${index}.` });
    const withActions = (actions: unknown[]) => card({ findings: [finding({ actions })] });

    /** @scenario "A finding may propose up to four actions for the insight saved from it" */
    it("takes four, and refuses five or a label past 40 characters", () => {
      expect(accepts(withActions([0, 1, 2, 3].map(action)))).toBe(true);
      expect(accepts(withActions([0, 1, 2, 3, 4].map(action)))).toBe(false);
      expect(accepts(withActions([{ label: "x".repeat(41), prompt: "Do it." }]))).toBe(false);
    });
  });

  describe("given a card with no findings", () => {
    /** @scenario "An insights card with no findings says nothing is worth reporting" */
    it("is accepted: an empty list is an answer", () => {
      expect(accepts(card({ findings: [] }))).toBe(true);
    });
  });

  describe("given a payload that is not this shape", () => {
    /** @scenario "A payload that is not genuinely an insights card is no insights card" */
    it.each([
      ["no findings list", card({ findings: undefined })],
      ["findings that are not a list", card({ findings: { 0: finding() } })],
      ["a finding with no title", card({ findings: [finding({ title: " " })] })],
      ["a finding with no body", card({ findings: [finding({ body: "" })] })],
      ["an unknown tone", card({ findings: [finding({ tone: "urgent" })] })],
      ["a validity of 400 days", card({ findings: [finding({ validDays: 400 })] })],
      ["a title that is not text", card({ findings: [finding({ title: 7 })] })],
      ["a title past 200 characters", card({ findings: [finding({ title: "x".repeat(201) })] })],
      ["a window with no end", card({ window: { start: 1, granularitySeconds: 60 } })],
      ["a board with no name", card({ board: { id: "dashboard-1" } })],
      ["no blockId", { kind: "insights", findings: [finding()] }],
      [
        "more findings than a card lists",
        card({ findings: Array.from({ length: INSIGHTS_CARD_MAX_FINDINGS + 1 }, () => finding()) }),
      ],
    ])("refuses a card with %s", (_what, candidate) => {
      expect(accepts(candidate)).toBe(false);
    });

    /** @scenario "A card that names anything a finding may not hold is refused whole" */
    it.each([
      ["an owner on a finding", card({ findings: [finding({ ownerUserId: "user-attacker" })] })],
      ["a project on a finding", card({ findings: [finding({ projectId: "project-2" })] })],
      ["a board on a finding", card({ findings: [finding({ board: { id: "b", name: "B" } })] })],
      ["an owner beside the findings", card({ ownerUserId: "user-attacker" })],
      ["a project on the board", card({ board: { id: "b", name: "B", projectId: "project-2" } })],
    ])("refuses a card that names %s", (_what, candidate) => {
      expect(accepts(candidate)).toBe(false);
      expect(langyModelEmittedCardSchema.validate(candidate)).toBe(false);
    });

    it("refuses another kind's payload that also carries findings", () => {
      const stats = { kind: "stats", blockId: "b1", items: [{ label: "a", value: 1 }] };

      expect(accepts({ ...stats, findings: [finding()] })).toBe(false);
    });
  });

  describe("given a fenced card as the relay reads it", () => {
    /** @scenario "A fenced insights card is stamped only when it validates" */
    it("stamps a well-formed card as insights and refuses one with an unlisted key", () => {
      const stamped = salvageLangyDerivedCard(JSON.stringify(card()));
      const refused = salvageLangyDerivedCard(
        JSON.stringify(card({ findings: [finding({ ownerUserId: "user-attacker" })] })),
      );

      expect(stamped.ok && stamped.card.kind).toBe("insights");
      expect(refused).toEqual({ ok: false, reason: "invalid" });
    });

    /** @scenario "A card repaired from damaged JSON says so on its part" */
    it("says a card cut off inside a finding's body was repaired, and a whole one was not", () => {
      const raw = JSON.stringify(card());
      const cutOff = raw.slice(0, raw.indexOf(" dollars against"));

      const whole = salvageLangyDerivedCard(raw);
      const repaired = salvageLangyDerivedCard(cutOff);

      expect(whole.ok && whole.repaired).toBe(false);
      expect(repaired.ok && repaired.repaired).toBe(true);
      expect(repaired.ok && repaired.card.kind === "insights" && repaired.card.findings).toEqual([
        {
          title: "Checkout cost doubled",
          tone: "bad",
          body: "Cost on checkout rose from 41 to 96",
        },
      ]);
    });
  });
});
