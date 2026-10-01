import { afterAll, describe, expect, it } from "vitest";

import { requireFetchTimeoutRule } from "../../src/rules/require-fetch-timeout.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});

afterAll(() => workspace.cleanup());

const CHANNEL = "modules/agent/process/src/channels/http/http.agent-api.channel.ts";

function report(code, filename = CHANNEL) {
  return runRule(requireFetchTimeoutRule, { code, cwd: workspace.cwd, filename });
}

describe("given a channel in a module's process half", () => {
  describe("when fetch is called with no init or an init without a signal", () => {
    /** @scenario "A channel fetch without an abort signal is reported" */
    it("reports fetchWithoutSignal on each call's line", () => {
      const found = report(
        [
          "export async function ping(url) {",
          "  await fetch(url);",
          '  await globalThis.fetch(url, { method: "POST" });',
          "}",
        ].join("\n"),
      );

      expect(found.map((finding) => [finding.line, finding.messageId])).toEqual([
        [2, "fetchWithoutSignal"],
        [3, "fetchWithoutSignal"],
      ]);
      expect(found[0].message).toBe(
        "This `fetch` has no abort signal, so a peer that never answers hangs the caller." +
          " Pass `signal: AbortSignal.timeout(ms)` (or a controller's signal) in the init object.",
      );
    });
  });

  describe("when the init carries a signal, spreads one in or is passed through", () => {
    /** @scenario "A channel fetch with an abort signal is left alone" */
    it("reports nothing", () => {
      const found = report(
        [
          "export async function ping(url, init, signal) {",
          "  await fetch(url, { signal: AbortSignal.timeout(5_000) });",
          "  await fetch(url, { method: 'POST', signal });",
          "  await fetch(url, { ...init, headers: {} });",
          "  await fetch(url, init);",
          "}",
        ].join("\n"),
      );

      expect(found).toEqual([]);
    });
  });
});

describe("given a file outside a channel", () => {
  describe("when it calls fetch without a signal", () => {
    it("reports nothing", () => {
      expect(
        report("await fetch(url);", "modules/agent/process/src/rules/agent-url.rules.ts"),
      ).toEqual([]);
    });
  });
});
