/**
 * Which runs call hooks, and how their results are kept on the run (ADR-180).
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */
import { describe, expect, it } from "vitest";

import {
  adapterDeclaresHooks,
  capRunHooks,
  hasHookResults,
  hookCallsEnvironment,
  MAX_HOOK_ERROR_LENGTH,
} from "../scenario-run-hooks.rules.ts";

const connected = {
  type: "connected" as const,
  agentId: "agent_1",
  endpoint: "http://app:5560",
  timeoutMs: 1_000,
};

describe("capRunHooks()", () => {
  describe("when a hook's state is over 64 KiB", () => {
    /** @scenario "Hook state over the cap is cut and marked" */
    it("marks the state as too large and keeps no partial copy", () => {
      const big = { blob: "x".repeat(70 * 1024) };
      const capped = capRunHooks({
        setup: { status: "ok", durationMs: 5, state: big },
        teardown: { status: "ok", durationMs: 5, state: big, returned: { deleted: 3 } },
      });

      expect(capped.setup).toEqual({ status: "ok", durationMs: 5, stateTooLarge: true });
      expect(capped.teardown).toEqual({
        status: "ok",
        durationMs: 5,
        stateTooLarge: true,
        returned: { deleted: 3 },
      });
    });
  });
});

describe("capRunHooks() on a long error", () => {
  describe("when a hook's error is longer than the record keeps", () => {
    /** @scenario "A hook's error is cut to the length the record keeps" */
    it("keeps the first MAX_HOOK_ERROR_LENGTH characters", () => {
      const capped = capRunHooks({
        setup: { status: "failed", durationMs: 5, error: "e".repeat(MAX_HOOK_ERROR_LENGTH + 500) },
      });

      expect(capped.setup?.error).toHaveLength(MAX_HOOK_ERROR_LENGTH);
    });
  });
});

describe("hookCallsEnvironment()", () => {
  describe("when the child is started for a run", () => {
    it("flags a run that calls hooks and leaves any other environment as it was", () => {
      expect(
        hookCallsEnvironment({ ...connected, hooks: { setup: true, teardown: false } }),
      ).toEqual({ callsHooks: true });
      expect(hookCallsEnvironment(connected)).toEqual({});
    });
  });
});

describe("hasHookResults()", () => {
  describe("when the result line carries no hook result", () => {
    /** @scenario "A result line with no hook results records nothing" */
    it("is false for no hooks and for an empty record", () => {
      expect(hasHookResults(undefined)).toBe(false);
      expect(hasHookResults({})).toBe(false);
      expect(hasHookResults({ teardown: { status: "skipped", durationMs: 0 } })).toBe(true);
    });
  });
});

describe("adapterDeclaresHooks()", () => {
  describe("when the target is a connected agent", () => {
    /** @scenario 'An agent with no hooks runs as today and is marked "No hooks"' */
    it("is true only when the agent declared setup or teardown", () => {
      expect(adapterDeclaresHooks(connected)).toBe(false);
      expect(adapterDeclaresHooks({ ...connected, hooks: { setup: false, teardown: false } })).toBe(
        false,
      );
      expect(adapterDeclaresHooks({ ...connected, hooks: { setup: false, teardown: true } })).toBe(
        true,
      );
    });
  });
});

describe("adapterDeclaresHooks() on an HTTP agent", () => {
  const http = {
    type: "http" as const,
    agentId: "agent_http",
    url: "https://shop.example.com/chat",
    method: "POST",
    headers: [],
    secrets: {},
  };

  describe("when the agent has hooks checked and no hooks URL", () => {
    /** @scenario "An HTTP agent with no hooks URL calls no hooks" */
    it("calls no hooks and needs no Node child", () => {
      const withoutUrl = { ...http, hooks: { setup: true, teardown: true } };

      expect(adapterDeclaresHooks(withoutUrl)).toBe(false);
      expect(hookCallsEnvironment(withoutUrl)).toEqual({});
    });
  });

  describe("when the agent has a hooks URL", () => {
    it("calls hooks only when one is checked", () => {
      const hooksUrl = "https://shop.example.com/hooks";

      expect(adapterDeclaresHooks({ ...http, hooksUrl })).toBe(false);
      expect(
        adapterDeclaresHooks({ ...http, hooksUrl, hooks: { setup: false, teardown: false } }),
      ).toBe(false);
      expect(
        hookCallsEnvironment({ ...http, hooksUrl, hooks: { setup: true, teardown: false } }),
      ).toEqual({ callsHooks: true });
    });
  });
});
