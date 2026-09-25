// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Port of main's `pulledUsageLedger.process.unit.test.ts`. Spec: specs/governance/governance-cost-rollup.feature */
import { describe, expect, it } from "vitest";

import type { PulledUsageLedgerState } from "../pulled-usage-ledger.process.ts";
import {
  GOV_PROJECT,
  LEDGER_REF,
  OCCURRED_AT,
  ORG_ID,
  RESTATEMENT_KEY,
  T0,
  ledgerRuntime,
  observation,
} from "./pulled-usage-ledger.fixtures.ts";

const DAY_MS = 86_400_000;

describe("resuming an instance persisted before the state carried a filed cell", () => {
  it("treats the missing cell as a first observation and files the charge", async () => {
    const { store, ledger, retraction, observe, drainOutbox } = ledgerRuntime();
    await store.commit({
      ref: LEDGER_REF,
      tenantId: GOV_PROJECT,
      state: {},
      expectedRevision: 0,
      nextWakeAt: null,
      sourceEventId: "legacy:ledger",
      messages: [],
      now: T0 - 1_000,
    });

    await observe(observation());
    await drainOutbox();

    expect(retraction.sent).toHaveLength(0);
    expect(ledger.rows).toHaveLength(1);
    const instance = await store.findByRef<PulledUsageLedgerState>({ ref: LEDGER_REF });
    expect(instance?.revision).toBe(2);
    expect(instance?.state.filedCell).toMatchObject({ currencyCode: "USD" });
  });
});

describe("recognising a reissued charge", () => {
  describe("given a day's bill already pulled in one currency", () => {
    /** @scenario "A bill reissued in another currency is withdrawn by the pull that finds it" */
    it("withdraws the first currency's version when the next pull returns another currency", async () => {
      const { retraction, observe, drainOutbox } = ledgerRuntime();

      await observe(observation({ currencyCode: "EUR", costNanoUsd: null }));
      await observe(
        observation({
          costNanoMinor: 13_000_000_000,
          costNanoUsd: 13_000_000_000,
          observedAtMs: T0 + DAY_MS,
        }),
      );
      await drainOutbox();

      expect(retraction.sent).toHaveLength(1);
      expect(retraction.sent[0]).toMatchObject({
        tenantId: GOV_PROJECT,
        occurredAt: OCCURRED_AT,
        restatementKey: RESTATEMENT_KEY,
        currencyCode: "EUR",
        costNanoMinor: 0,
        occurredAtMs: OCCURRED_AT,
        observedAtMs: T0 + DAY_MS,
      });
    });

    it("remembers a version it could not write a ledger row for", async () => {
      const { store, ledger, observe } = ledgerRuntime();

      await observe(observation({ currencyCode: "EUR", costNanoUsd: null }));

      expect(ledger.rows).toHaveLength(0);
      const instance = await store.findByRef<PulledUsageLedgerState>({ ref: LEDGER_REF });
      expect(instance?.state.filedCell).toMatchObject({ currencyCode: "EUR" });
    });
  });

  describe("given a charge whose reissue has already been withdrawn", () => {
    /** @scenario "Pulling the corrected day again withdraws nothing" */
    it("withdraws nothing when the corrected day is pulled again unchanged", async () => {
      const { retraction, observe, drainOutbox } = ledgerRuntime();

      await observe(observation({ currencyCode: "EUR", costNanoUsd: null }));
      await observe(observation({ observedAtMs: T0 + DAY_MS }));
      await drainOutbox();
      expect(retraction.sent).toHaveLength(1);

      await observe(observation({ observedAtMs: T0 + 2 * DAY_MS }));
      await drainOutbox();

      expect(retraction.sent).toHaveLength(1);
    });
  });

  describe("given a charge already reissued once", () => {
    /** @scenario "A charge reissued a second time is compared against where it sits now" */
    it("withdraws the version it currently sits in, not the one it started in", async () => {
      const { retraction, observe, drainOutbox } = ledgerRuntime();

      await observe(observation({ currencyCode: "EUR", costNanoUsd: null }));
      await observe(observation({ observedAtMs: T0 + DAY_MS }));
      await observe(observation({ rawActorId: "someone-else", observedAtMs: T0 + 2 * DAY_MS }));
      await drainOutbox();

      expect(retraction.sent).toHaveLength(2);
      expect(retraction.sent[1]).toMatchObject({ currencyCode: "USD", rawActorId: "" });
    });
  });

  describe("given a period that holds more than one model", () => {
    const OMITS_MODEL_SOURCE = "example_cost_source";

    /** @scenario "A reissue is recognised from the currency, the agent and the spender only" */
    it("withdraws nothing when only the model differs", async () => {
      const { ledger, retraction, observe, drainOutbox } = ledgerRuntime();

      await observe(observation({ source: OMITS_MODEL_SOURCE, model: "example/meter-a" }));
      await observe(
        observation({
          source: OMITS_MODEL_SOURCE,
          model: "example/meter-b",
          observedAtMs: T0 + 3_600_000,
        }),
      );
      await drainOutbox();

      expect(retraction.sent).toHaveLength(0);
      expect(ledger.rows).toHaveLength(2);
    });

    it("still addresses the superseded model when the currency moves too", async () => {
      const { retraction, observe, drainOutbox } = ledgerRuntime();

      await observe(observation({ source: OMITS_MODEL_SOURCE, model: "example/meter-a" }));
      await observe(
        observation({
          source: OMITS_MODEL_SOURCE,
          model: "example/meter-b",
          currencyCode: "EUR",
          costNanoUsd: null,
          observedAtMs: T0 + 3_600_000,
        }),
      );
      await drainOutbox();

      expect(retraction.sent).toHaveLength(1);
      expect(retraction.sent[0]).toMatchObject({ model: "example/meter-a", currencyCode: "USD" });
    });
  });

  describe("given the withdrawal switch is off for the organization", () => {
    it("detects the reissue but withdraws nothing", async () => {
      const { retraction, observe, drainOutbox } = ledgerRuntime();
      retraction.enabled = false;

      await observe(observation({ currencyCode: "EUR", costNanoUsd: null }));
      await observe(observation({ observedAtMs: T0 + DAY_MS }));
      await drainOutbox();

      expect(retraction.asked).toContain(ORG_ID);
      expect(retraction.sent).toHaveLength(0);
    });
  });
});
