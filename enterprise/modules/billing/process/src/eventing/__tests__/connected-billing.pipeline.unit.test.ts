/** @see specs/self-hosting/connected-services/connected-billing.feature */
import { describe, expect, it, vi } from "vitest";

import { billingServer } from "../../billing.server.ts";
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

const BOOTED_AT = 1_700_000_000_000;
const MINUTE_MS = 60 * 1000;

function wakeAt({ at, lastTickAt }: { at: number; lastTickAt: number | null }) {
  const tick = vi.fn((messageKey: string, payload: { scheduledFor: number }) => ({
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
      intents: { tick },
    },
  );
  return tick;
}

describe("given the connected billing tick's eventing declaration", () => {
  it("carries the daily tick onto the installable module", () => {
    expect(billingServer.eventing).toBe(connectedBillingEventing);
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
