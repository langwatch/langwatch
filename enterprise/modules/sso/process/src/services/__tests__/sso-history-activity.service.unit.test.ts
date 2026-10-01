// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The live signal behind the connection's event log: it ticks when the newest
 * event moves and stays quiet otherwise (specs/identity/sso-connection-history).
 */
import { describe, expect, it, vi } from "vitest";

import { SsoHistoryActivityService } from "../sso-history-activity.service.ts";

const TARGET = { organizationId: "org_acme", connectionId: "ssoc_1" };

const logger = { warn: vi.fn() };

function entry(eventId: string) {
  return {
    eventId,
    occurredAtMs: 1_764_000_000_000,
    summary: "Something happened.",
    carriedOver: false,
  };
}

describe("the connection history signal", () => {
  describe("given nothing has changed since the last poll", () => {
    /** @scenario "A poll that finds nothing new says nothing" */
    it("says nothing at all, and ends when the listener leaves", async () => {
      const controller = new AbortController();
      let polls = 0;
      const getHistory = vi.fn(async () => {
        polls += 1;
        if (polls >= 3) controller.abort();
        return [entry("evt_1")];
      });
      const ticks = SsoHistoryActivityService.create({
        history: { getHistory },
        logger,
        pollMs: 0,
      }).ticks({
        ...TARGET,
        signal: controller.signal,
      });

      await expect(ticks.next()).resolves.toEqual({ done: true, value: void 0 });
      expect(polls).toBeGreaterThanOrEqual(2);
    });
  });

  describe("given a new fact was appended", () => {
    /** @scenario "A new fact wakes the signal, and only for its own organization" */
    it("ticks once, naming the connection and nothing about what changed", async () => {
      const events = [entry("evt_1"), entry("evt_2")];
      let polls = 0;
      const getHistory = vi.fn(async () => {
        polls += 1;
        return [events[Math.min(polls - 1, events.length - 1)]!];
      });
      const controller = new AbortController();
      const ticks = SsoHistoryActivityService.create({
        history: { getHistory },
        logger,
        pollMs: 0,
      }).ticks({
        ...TARGET,
        signal: controller.signal,
      });

      await expect(ticks.next()).resolves.toEqual({
        done: false,
        value: { connectionId: TARGET.connectionId },
      });
      // Only ever the tenant it was constructed with: there is no widening.
      expect(getHistory).toHaveBeenCalledWith({ ...TARGET, limit: 1 });
      controller.abort();
    });
  });

  describe("given the read failed for a moment", () => {
    it("tries again rather than tearing the subscription down", async () => {
      let polls = 0;
      const getHistory = vi.fn(async () => {
        polls += 1;
        if (polls === 1) throw new Error("datastore unavailable");
        return [entry(polls >= 3 ? "evt_2" : "evt_1")];
      });
      const controller = new AbortController();
      const ticks = SsoHistoryActivityService.create({
        history: { getHistory },
        logger,
        pollMs: 0,
      }).ticks({
        ...TARGET,
        signal: controller.signal,
      });

      await expect(ticks.next()).resolves.toMatchObject({ done: false });
      controller.abort();
    });
  });
});
