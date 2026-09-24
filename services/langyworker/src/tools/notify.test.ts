import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import {
  createNotifyExtension,
  createNotifyLedger,
  EMPTY_NOTIFY_PUSHBACK,
  NOTIFY_HOURLY_BUDGET,
  NOTIFY_MIN_GAP_MS,
  NOTIFY_SENT,
  NOTIFY_TOOL_NAME,
  notifyRefusal,
  OFFER_NOTIFICATIONS_TOOL_NAME,
  OFFER_REPEATED_PUSHBACK,
  OFFER_SHOWN,
  type NotifyLedger,
} from "./notify.js";

type RegisteredTool = {
  name: string;
  description: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
  ) => Promise<{ content: { type: string; text: string }[] }>;
};

function registerTools({ ledger, now }: { ledger?: NotifyLedger; now?: () => number } = {}) {
  const tools = new Map<string, RegisteredTool>();
  const pi = { registerTool: (tool: RegisteredTool) => tools.set(tool.name, tool) };
  const extension = createNotifyExtension({ ledger, now }) as unknown as {
    factory: (pi: ExtensionAPI) => void;
  };
  extension.factory(pi as unknown as ExtensionAPI);
  const notify = tools.get(NOTIFY_TOOL_NAME);
  const offer = tools.get(OFFER_NOTIFICATIONS_TOOL_NAME);
  if (!notify || !offer) throw new Error("the notify tools did not register");
  return { notify, offer };
}

const MINUTE = 60_000;

describe("notifyRefusal", () => {
  describe("when nothing was sent yet", () => {
    it("lets the first notification through", () => {
      expect(notifyRefusal({ now: 0, sentAt: [] })).toBeUndefined();
    });
  });

  describe("given Langy sent a notification less than a minute ago", () => {
    /** @scenario "The notify tool refuses a second call within a minute" */
    it("refuses and says when the next may go", () => {
      const refusal = notifyRefusal({ now: 20_000, sentAt: [0] });

      expect(refusal).toContain("20 seconds ago");
      expect(refusal).toContain("next may go in 40 seconds");
    });

    it("lets one through once the minute has passed", () => {
      expect(notifyRefusal({ now: NOTIFY_MIN_GAP_MS, sentAt: [0] })).toBeUndefined();
    });
  });

  describe("given Langy sent five notifications in the last hour", () => {
    /** @scenario "The notify tool refuses past its hourly budget" */
    it("refuses the sixth", () => {
      const sentAt = [0, 10, 20, 30, 40].map((m) => m * MINUTE);
      expect(sentAt).toHaveLength(NOTIFY_HOURLY_BUDGET);

      const refusal = notifyRefusal({ now: 50 * MINUTE, sentAt });

      expect(refusal).toContain("the limit");
      expect(refusal).toContain("next may go in 10 minutes");
    });

    it("lets one through once the oldest is an hour old", () => {
      const sentAt = [0, 10, 20, 30, 40].map((m) => m * MINUTE);

      expect(notifyRefusal({ now: 60 * MINUTE, sentAt })).toBeUndefined();
    });
  });
});

describe("the notify tool", () => {
  it("registers under the name the panel reads", () => {
    const { notify } = registerTools();

    expect(notify.name).toBe("notify");
    expect(notify.description).toContain("Never for progress");
  });

  describe("when the model calls it twice within a minute", () => {
    it("sends the first and refuses the second with the wait", async () => {
      let clock = 0;
      const { notify } = registerTools({ now: () => clock });
      const params = { title: "Your project is ready", body: "Tracing and a suite are set up." };

      const first = await notify.execute("call-1", params);
      expect(first.content[0]?.text).toBe(NOTIFY_SENT);

      clock = 30_000;
      await expect(notify.execute("call-2", params)).rejects.toThrow("next may go in 30 seconds");
    });
  });

  describe("when the title is empty", () => {
    it("refuses and spends nothing from the budget", async () => {
      const ledger = createNotifyLedger();
      const { notify } = registerTools({ ledger });

      await expect(notify.execute("call-1", { title: "  ", body: "x" })).rejects.toThrow(
        EMPTY_NOTIFY_PUSHBACK,
      );
      expect(ledger.sentAt).toEqual([]);
    });
  });
});

describe("the offer_notifications tool", () => {
  describe("given the worker already offered notifications in this conversation", () => {
    /** @scenario "Langy offers notifications only once per conversation" */
    it("refuses the second offer", async () => {
      const { offer } = registerTools();

      const first = await offer.execute("call-1", {});
      expect(first.content[0]?.text).toBe(OFFER_SHOWN);

      await expect(offer.execute("call-2", {})).rejects.toThrow(OFFER_REPEATED_PUSHBACK);
    });
  });
});
