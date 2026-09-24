import { describe, expect, it, vi } from "vitest";

import { AutomationTriggerMatchDispatcherService } from "../automation-trigger-match-dispatcher.service.ts";

const match = {
  tenantId: "project-1",
  occurredAt: 1_700_000_000_000,
  triggerId: "trigger-1",
  traceId: "trace-1",
  action: "SEND_EMAIL",
  actionClass: "notify",
  traceDebounceMs: 0,
  notificationCadence: "immediate",
} as const;

describe("AutomationTriggerMatchDispatcherService", () => {
  describe("given no automations pipeline was registered", () => {
    /** @scenario "A trigger match refuses by name when this process hosts no automations pipeline" */
    it("refuses the match, naming the missing sender", async () => {
      const dispatcher = AutomationTriggerMatchDispatcherService.create();

      await expect(dispatcher.send(match)).rejects.toThrow(/hosts no automations pipeline/);
    });
  });

  describe("given the registered pipeline's senders", () => {
    /** @scenario "A trigger match is recorded through the automations pipeline's own sender" */
    it("sends the match through recordTriggerMatch", async () => {
      const send = vi.fn(async () => undefined);
      const dispatcher = AutomationTriggerMatchDispatcherService.create();
      dispatcher.connect({
        recordTriggerMatch: {
          send,
          sendBatch: vi.fn(async () => undefined),
          close: vi.fn(async () => undefined),
          waitUntilReady: vi.fn(async () => undefined),
        },
      });

      await dispatcher.send(match);

      expect(send).toHaveBeenCalledWith(match);
    });
  });
});
