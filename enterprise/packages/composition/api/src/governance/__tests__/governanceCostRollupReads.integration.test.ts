// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The two aggregate reads against real ClickHouse, for the two rules that live
 * entirely in their SQL and that no stubbed client can see.
 *
 * Both are arithmetic over money and both were wrong in the same direction —
 * they described a day as holding something it did not hold. A service-seam
 * test with a repository double cannot reach either, because the double hands
 * back the very numbers the SQL is supposed to compute.
 *
 * Rows are written straight to the table rather than folded from events: what
 * is under test is what the READ does with a given set of cells, which is a
 * property of the query and not of the fold. Merges are deliberately NOT
 * frozen here — every cell is written once, so there is no superseded version
 * for a merge to collapse, and freezing a shared table strands other files.
 *
 * Spec: specs/governance/governance-cost-rollup.feature
 * Spec: specs/governance/governance-cost-restatement-markers.feature
 * Decision: ADR-128 §3, §15.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getTestClickHouseClient } from "~/server/event-sourcing/__tests__/integration/testContainers";

import {
  GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
  GOVERNANCE_COST_SOURCE,
} from "../governanceCostRollup.clickhouse.repository.ts";
import {
  GovernanceCostRollupClickHouseRepository,
  type GovernanceCostRollupRow,
} from "../governanceCostRollup.clickhouse.repository";

/** Well inside the table's 13-month TTL horizon, so nothing is swept mid-test. */
const DAY = "2026-01-15";
const DAY_MS = Date.parse(`${DAY}T09:30:00.000Z`);
const NANO = 1_000_000_000;

let ch: ClickHouseClient;
let repo: GovernanceCostRollupClickHouseRepository;
let tenantId: string;

/**
 * One stored cell.
 *
 * `amountNanoUsd` and `amountNanoMinor` are separate arguments on purpose.
 * A cell billed in euros whose provider published no dollar figure carries a
 * real `AmountNanoMinor` beside a null `AmountNanoUsd`, and telling that apart
 * from a cell holding no money at all is the whole subject of the first test.
 */
function cell({
  currencyCode,
  amountNanoUsd,
  amountNanoMinor,
  model = "anthropic/claude-sonnet-5",
  rawActorId = "",
  previousAmountNanoUsd = null,
  revisedAtSeconds = null,
  revisionCount = 0,
  at = DAY_MS,
  createdAtMs = DAY_MS,
}: {
  currencyCode: string;
  amountNanoUsd: number | null;
  amountNanoMinor: number;
  model?: string;
  rawActorId?: string;
  previousAmountNanoUsd?: number | null;
  revisedAtSeconds?: number | null;
  revisionCount?: number;
  at?: number;
  /**
   * When this cell came into existence, which is the ONLY thing separating a
   * cell the revision created from one that was simply never revised. Both
   * carry no revision timestamp and no earlier amount, so every other column
   * answers identically; a cell created BY the revision exists from the
   * revision instant onward, and one that predates it does not.
   *
   * Defaults to the day's usual instant, i.e. ordinary usage that was already
   * there. A created cell must be stamped at its revision.
   */
  createdAtMs?: number;
}): GovernanceCostRollupRow {
  return {
    TenantId: tenantId,
    Day: DAY,
    CostSource: GOVERNANCE_COST_SOURCE.PULLED,
    IngestionSourceId: "src_a",
    Provider: "anthropic_admin",
    Model: model,
    AgentId: "",
    CurrencyCode: currencyCode,
    RawActorId: rawActorId,
    OrganizationId: "org_test_money",
    ExactOrEstimate: "exact",
    AmountNanoUsd: amountNanoUsd,
    AmountNanoMinor: amountNanoMinor,
    TokensInput: 1_000,
    TokensOutput: 200,
    TokensCacheRead: 0,
    TokensCacheWrite: 0,
    RequestCount: 1,
    RevisionCount: revisionCount,
    PreviousAmountNanoUsd: previousAmountNanoUsd,
    // `DateTime` columns, so SECONDS here, unlike the millisecond fields.
    RevisedAt: revisedAtSeconds,
    LastObservedAt: Math.floor(at / 1000),
    PulledItemsJson: "{}",
    Version: GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
    AppliedEventIds: [],
    CreatedAt: createdAtMs,
    LastEventOccurredAt: DAY_MS,
    EventTimestamp: at,
  };
}

async function readTheDay() {
  const rows = await repo.sumDaysByLane({
    tenantId,
    fromDay: DAY,
    toDay: DAY,
  });
  const row = rows.find(
    (candidate) => candidate.costSource === GOVERNANCE_COST_SOURCE.PULLED,
  );
  if (!row) throw new Error(`No pulled lane read back for ${DAY}`);
  return row;
}

describe("the governance cost aggregate reads", () => {
  beforeAll(() => {
    const client = getTestClickHouseClient();
    if (!client) throw new Error("Test ClickHouse is not available");
    ch = client;
    repo = new GovernanceCostRollupClickHouseRepository(async () => ch);
  });

  beforeEach(() => {
    // A fresh tenant per test: the table is shared, so no test can see
    // another's rows.
    tenantId = `proj-costreads-${nanoid(8)}`;
  });

  describe("given a day holding dollars, euros, and a cell with no money on it", () => {
    /** @scenario "A cell priced in another currency is not a cell we hold no amount for" */
    it("counts only the cell holding no amount at all, not the one billed in euros", async () => {
      await repo.upsert(
        cell({
          currencyCode: "USD",
          amountNanoUsd: 100 * NANO,
          amountNanoMinor: 100 * NANO,
          model: "anthropic/claude-sonnet-5",
        }),
      );
      await repo.upsert(
        // Billed in euros, and the provider published no dollar figure for it.
        // It holds a perfectly good amount; what it does not hold is a DOLLAR
        // amount, and the euro line is where that amount is shown.
        cell({
          currencyCode: "EUR",
          amountNanoUsd: null,
          amountNanoMinor: 40 * NANO,
          model: "anthropic/claude-opus-4",
        }),
      );
      await repo.upsert(
        // No currency and no money: usage we know happened and hold no price
        // for in any currency at all. This is the only genuinely unpriced cell
        // of the three.
        cell({
          currencyCode: "",
          amountNanoUsd: null,
          amountNanoMinor: 0,
          model: "anthropic/claude-haiku-4",
        }),
      );

      const day = await readTheDay();

      expect(day.cellsWithoutAmount).toBe(1);
      // 2 is the old rule's answer: it counted every cell with no DOLLAR
      // figure, so the euro cell withheld the dollar total of any day that
      // touched a foreign bill.
      expect(day.cellsWithoutAmount).not.toBe(2);

      const byProvider = await repo.sumWindowByProvider({
        tenantId,
        fromDay: DAY,
        toDay: DAY,
      });
      // The same rule, in the read the billed headline is built from. Both
      // reads count unpriced cells and the two must not disagree.
      expect(
        byProvider.find((row) => row.provider === "anthropic_admin")
          ?.cellsWithoutAmount,
      ).toBe(1);
    });

    // Untagged control. The scenario above proves the euro cell is not among
    // those counted; this proves the consequence that made it matter — with no
    // genuinely unpriced cell present, the euro cell alone no longer withholds
    // the dollar figure. Without it, an implementation that counted euro cells
    // AND some fourth thing could still satisfy the count of 1.
    it("states the dollar figure over a day whose only other cell is priced in euros", async () => {
      await repo.upsert(
        cell({
          currencyCode: "USD",
          amountNanoUsd: 100 * NANO,
          amountNanoMinor: 100 * NANO,
          model: "anthropic/claude-sonnet-5",
        }),
      );
      await repo.upsert(
        cell({
          currencyCode: "EUR",
          amountNanoUsd: null,
          amountNanoMinor: 40 * NANO,
          model: "anthropic/claude-opus-4",
        }),
      );

      const day = await readTheDay();

      expect(day.cellsWithoutAmount).toBe(0);
      expect(day.amountNanoUsd).toBe(100 * NANO);
      // Never the two currencies added together. ADR-128 §3 forbids summing
      // across currencies and there is no rate here to do it with.
      expect(day.amountNanoUsd).not.toBe(140 * NANO);
      // The euros are still reported as money the dollar figure leaves out.
      expect(day.currenciesWithoutUsdAmount).toContain("EUR");
    });
  });

  describe("given two spenders' cells restated a fortnight apart", () => {
    /** @scenario "A day restated twice reports only the latest move" */
    it("names what the dollar line held just before the latest revision", async () => {
      // The second Then of this scenario, on the line rather than on the day.
      // Area P binds the first Then and the day-level arithmetic in the rollup
      // store test; this is the same day read for the shape a reader is shown.
      const early = Math.floor(Date.parse("2026-01-05T04:00:00.000Z") / 1000);
      const late = Math.floor(Date.parse("2026-01-20T04:00:00.000Z") / 1000);

      // ada: 100 -> 120, restated on the 5th.
      await repo.upsert(
        cell({
          currencyCode: "USD",
          amountNanoUsd: 120 * NANO,
          amountNanoMinor: 120 * NANO,
          rawActorId: "actor_ada",
          previousAmountNanoUsd: 100 * NANO,
          revisedAtSeconds: early,
          revisionCount: 1,
        }),
      );
      // bob: 200 -> 250, restated on the 20th, which is the day's latest.
      await repo.upsert(
        cell({
          currencyCode: "USD",
          amountNanoUsd: 250 * NANO,
          amountNanoMinor: 250 * NANO,
          rawActorId: "actor_bob",
          previousAmountNanoUsd: 200 * NANO,
          revisedAtSeconds: late,
          revisionCount: 1,
        }),
      );

      const day = await readTheDay();
      const dollars = day.byCurrency.find(
        (line) => line.currencyCode === "USD",
      );

      expect(day.revisedAt).toBe(late);
      // 120 + 200. By the 20th ada was already carrying its restated figure,
      // so it contributes what it holds, not what it held on the 5th.
      expect(dollars?.previousAmountNanoMinor).toBe(320 * NANO);
      // 100 + 200 is what summing every revised cell's prior figure gives, and
      // it reports a move of 70 under a date whose move was 50.
      expect(dollars?.previousAmountNanoMinor).not.toBe(300 * NANO);
      expect(dollars?.cellsWithoutPreviousAmount).toBe(0);
    });
  });

  describe("given a day whose dollar charge was retracted and reissued in euros", () => {
    /** @scenario "A day reissued in another currency names what it held before, not the two amounts added together" */
    it("names each currency's amount as it stood before the reissue and adds none of them together", async () => {
      const revisedAtSeconds = Math.floor(
        Date.parse(`${DAY}T11:00:00.000Z`) / 1000,
      );

      // The retracted cell. Settlement 9 zeroes what the key held rather than
      // removing it, so it reads as a stated zero and still names what it held
      // before the reissue.
      await repo.upsert(
        cell({
          currencyCode: "USD",
          amountNanoUsd: 0,
          amountNanoMinor: 0,
          rawActorId: "actor_a",
          previousAmountNanoUsd: 12 * NANO,
          revisedAtSeconds,
          revisionCount: 1,
        }),
      );
      // The cell the reissue CREATED. Before that revision it did not exist,
      // so it held nothing and contributes nothing to what the day held before.
      //
      // It carries NO revision timestamp, because nothing has ever restated
      // it — it is itself the restatement. That is what makes this the hard
      // case: asked "was this cell revised?" it answers no and lands in the
      // untouched bucket, where a cell is taken to have held all along what it
      // holds now. Asked "does this cell have an earlier amount?" it also
      // answers no, and lands correctly on zero.
      //
      // It came into existence AT the reissue, which is the one column that
      // tells it apart from the never-revised cell below. Both answer no to
      // every question about revision; only their creation instants differ.
      await repo.upsert(
        cell({
          currencyCode: "EUR",
          amountNanoUsd: null,
          amountNanoMinor: 10 * NANO,
          rawActorId: "actor_a",
          previousAmountNanoUsd: null,
          revisedAtSeconds: null,
          revisionCount: 0,
          createdAtMs: revisedAtSeconds * 1000,
        }),
      );
      // Untouched by that revision, and still contributing what it holds now.
      await repo.upsert(
        cell({
          currencyCode: "USD",
          amountNanoUsd: 5 * NANO,
          amountNanoMinor: 5 * NANO,
          rawActorId: "actor_b",
          model: "anthropic/claude-haiku-4",
        }),
      );

      const day = await readTheDay();

      expect(day.revisedAt).toBe(revisedAtSeconds);

      // 12 from the retracted cell's prior amount, 5 from the untouched cell's
      // current amount, nothing from the cell the revision created.
      expect(day.previousAmountNanoUsd).toBe(17 * NANO);
      // Nothing about this day is unknown: every cell either names what it held
      // or provably held nothing, so the figure is stated rather than withheld.
      expect(day.cellsWithoutPreviousAmount).toBe(0);
      // The sum itself survives the old rule here by luck: the created cell
      // holds no dollar figure, so treating it as untouched adds a null that
      // falls to zero and lands on the right number for the wrong reason. The
      // count above is what gives the defect away in this case, and the
      // untagged control below is where the same fault moves the money.

      // Per currency, always: the day reads as having held dollars and now
      // holding euros, never as having held their sum.
      const dollars = day.byCurrency.find(
        (line) => line.currencyCode === "USD",
      );
      const euros = day.byCurrency.find((line) => line.currencyCode === "EUR");

      expect(dollars?.previousAmountNanoMinor).toBe(17 * NANO);
      expect(dollars?.amountNanoMinor).toBe(5 * NANO);
      // The euros held none of it before, and say so rather than naming zero:
      // a currency that did not exist on this day yesterday has no earlier
      // figure to name.
      expect(euros?.previousAmountNanoMinor).toBeNull();
      expect(euros?.amountNanoMinor).toBe(10 * NANO);
    });

    // Untagged control, and the reason the rule is worded as it is.
    //
    // In the currency case above the created cell holds no dollar figure, so
    // treating it as untouched adds null and the sum survives by luck — only
    // the withholding gives the defect away. Reissue in the SAME currency and
    // the luck runs out: the created cell contributes its new amount on top of
    // the retracted cell's prior one, and the day reports having previously
    // held 42 when it held 12. Both are the one discriminator being wrong, and
    // an implementation fixing only the count would still pass the scenario.
    it("does not add a cell the revision created to what the day held before it", async () => {
      const revisedAtSeconds = Math.floor(
        Date.parse(`${DAY}T11:00:00.000Z`) / 1000,
      );

      await repo.upsert(
        cell({
          currencyCode: "USD",
          amountNanoUsd: 0,
          amountNanoMinor: 0,
          rawActorId: "actor_a",
          previousAmountNanoUsd: 12 * NANO,
          revisedAtSeconds,
          revisionCount: 1,
        }),
      );
      // Created BY the reissue, so it came into existence at the reissue and
      // held nothing before it. Same currency as the retracted cell, which is
      // what makes this control bite: treat it as untouched and the day claims
      // to have previously held 42 when it held 12.
      await repo.upsert(
        cell({
          currencyCode: "USD",
          amountNanoUsd: 30 * NANO,
          amountNanoMinor: 30 * NANO,
          rawActorId: "actor_b",
          previousAmountNanoUsd: null,
          revisedAtSeconds: null,
          revisionCount: 0,
          createdAtMs: revisedAtSeconds * 1000,
        }),
      );

      const day = await readTheDay();

      expect(day.previousAmountNanoUsd).toBe(12 * NANO);
      // 42 is the created cell counted as though it had held its new amount
      // all along.
      expect(day.previousAmountNanoUsd).not.toBe(42 * NANO);
      expect(day.cellsWithoutPreviousAmount).toBe(0);
      // The day holds 30 now and held 12 before it, so the reader is shown a
      // rise and not a day that spent 42 yesterday.
      expect(day.amountNanoUsd).toBe(30 * NANO);
    });
  });
});
