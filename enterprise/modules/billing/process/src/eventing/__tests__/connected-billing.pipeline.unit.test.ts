import type { JsonValue } from "@langwatch/eventing";
import { intentAccessorOf } from "@langwatch/eventing/testing";
/** @see specs/self-hosting/connected-services/connected-billing.feature */
import { describe, expect, it, vi } from "vitest";

import { billingProcessModule } from "../../billing.module.ts";
import { CONNECTED_BILLING_PROCESS_NAME } from "../connected-billing.intent.ts";
import {
  CONNECTED_BILLING_PIPELINE_NAME,
  connectedBillingEventing,
} from "../connected-billing.pipeline.ts";
import {
  CONNECTED_BILLING_FIRST_DELAY_MS,
  CONNECTED_BILLING_TICK_INTERVAL_MS,
  connectedBillingWake,
} from "../connected-billing.process.ts";
import { runSeatInvoicingPass } from "../seat-invoicing.intent.ts";
import { SEAT_INVOICING_PROCESS_NAME, seatInvoicingWake } from "../seat-invoicing.process.ts";

const BOOTED_AT = 1_700_000_000_000;
const MINUTE_MS = 60 * 1000;

function wakeAt({ at, lastTickAt }: { at: number; lastTickAt: number | null }) {
  const tick = vi.fn((messageKey: string, payload: JsonValue) => ({
    messageKey,
    intentType: "tick",
    payload,
  }));
  connectedBillingWake({ bootedAt: BOOTED_AT })(
    { lastTickAt },
    {
      at,
      now: at,
      key: CONNECTED_BILLING_PROCESS_NAME,
      projectId: "__global__",
      intent: intentAccessorOf({ tick }),
    },
  );
  return tick;
}

describe("given the connected billing tick's eventing declaration", () => {
  it("carries the daily tick onto the installable module", () => {
    expect(billingProcessModule.eventing?.pipeline.split(", ")).toContain(CONNECTED_BILLING_PIPELINE_NAME);
    expect(connectedBillingEventing.pipeline).toBe(CONNECTED_BILLING_PIPELINE_NAME);
  });

  describe("given LangWatch Cloud has just come up", () => {
    it("waits five minutes for the process to come up, then ticks", () => {
      expect(wakeAt({ at: BOOTED_AT + MINUTE_MS, lastTickAt: null })).not.toHaveBeenCalled();
      expect(
        wakeAt({ at: BOOTED_AT + CONNECTED_BILLING_FIRST_DELAY_MS, lastTickAt: null }),
      ).toHaveBeenCalledTimes(1);
    });
  });

  describe("given it ticked since it came up", () => {
    it("ticks again once a day has passed, and not before", () => {
      const lastTickAt = BOOTED_AT + CONNECTED_BILLING_FIRST_DELAY_MS;
      expect(wakeAt({ at: lastTickAt + MINUTE_MS, lastTickAt })).not.toHaveBeenCalled();
      expect(
        wakeAt({ at: lastTickAt + CONNECTED_BILLING_TICK_INTERVAL_MS, lastTickAt }),
      ).toHaveBeenCalledTimes(1);
    });
  });
});

describe("given the seat invoicing pass", () => {
  /** @scenario "Seat changes are invoiced by a pass every minute on the billing pipeline" */
  it("asks for one pass on every wake, keyed by the wake", () => {
    const pass = vi.fn((messageKey: string, payload: JsonValue) => ({
      messageKey,
      intentType: "pass",
      payload,
    }));
    const at = BOOTED_AT + MINUTE_MS;

    const evolved = seatInvoicingWake(
      { lastPassAt: null },
      {
        at,
        now: at,
        key: SEAT_INVOICING_PROCESS_NAME,
        projectId: "__global__",
        intent: intentAccessorOf({ pass }),
      },
    );

    expect(evolved.state).toEqual({ lastPassAt: at });
    expect(pass).toHaveBeenCalledWith(`pass:${at}`, { scheduledFor: at });
  });

  it("runs the pass, then prunes its own outbox rows older than a day", async () => {
    const ran: string[] = [];
    const pruned: { processName: string; before: number }[] = [];

    await runSeatInvoicingPass({
      pass: async () => {
        ran.push("pass");
      },
      deleteDispatchedBefore: async (params) => {
        pruned.push(params);
        return 0;
      },
      now: () => BOOTED_AT,
    })();

    expect(ran).toEqual(["pass"]);
    expect(pruned).toEqual([
      { processName: SEAT_INVOICING_PROCESS_NAME, before: BOOTED_AT - 24 * 60 * MINUTE_MS },
    ]);
  });
});
