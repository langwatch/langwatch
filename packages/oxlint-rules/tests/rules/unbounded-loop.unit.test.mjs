import { afterAll, describe, expect, it } from "vitest";

import { unboundedLoopRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {} } } },
});

afterAll(() => workspace.cleanup());

const SERVICE = "modules/agent/process/src/services/agent-dispatch.service.ts";
const TEST = "modules/agent/process/src/services/__tests__/agent-dispatch.unit.test.ts";

function report(code, filename = SERVICE) {
  return runRule(unboundedLoopRule, { code, cwd: workspace.cwd, filename });
}

describe("given a strict feature server module", () => {
  describe("when a loop states no exit condition in its header", () => {
    /** @scenario "A loop without an exit condition in its header is reported" */
    it("reports for (;;)", () => {
      const found = report(`export async function pick(signal: AbortSignal) {
  for (;;) {
    throwIfAborted(signal);
    const instance = await next();
    if (instance) return instance;
  }
}`);

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("unboundedLoop");
      expect(found[0].message).toBe(
        "This `for (;;)` loop states no exit condition in its header." +
          " State whichever bound this loop already tracks directly in its header — a deadline" +
          " (`while (now() < deadline)`) or an attempt counter" +
          " (`for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++)`) — or, if it tracks no such" +
          " bound yet, move it into a function whose signature takes one as a parameter.",
      );
    });

    /** @scenario "A loop without an exit condition in its header is reported" */
    it("reports while (true) and do … while (true)", () => {
      const found = report(`export function drain() {
  while (true) {
    if (!step()) break;
  }

  do {
    tick();
  } while (true);
}`);

      expect(found.map((entry) => entry.messageId)).toEqual(["unboundedLoop", "unboundedLoop"]);
    });
  });

  describe("when the loop carries its exit in the header", () => {
    /** @scenario "A loop with its exit condition in the header is left alone" */
    it("reports nothing for a deadline, a budget or a queue", () => {
      const found = report(`export async function poll(deadline: number, now: () => number) {
  while (now() < deadline) {
    await step();
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (await tryOnce()) return;
  }

  for (const frame of frames) {
    handle(frame);
  }
}`);

      expect(found).toEqual([]);
    });
  });

  describe("when the loop drains a stream until it is done", () => {
    /** @scenario "Draining a stream until done is left alone" */
    it("reports nothing for a reader or an iterator read to its end", () => {
      const found = report(`export async function drain(reader: Reader, iterator: Iterator) {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    handle(value);
  }

  for (;;) {
    const step = await iterator.next();
    if (step.done) {
      return;
    }
    handle(step.value);
  }
}`);

      expect(found).toEqual([]);
    });

    /** @scenario "A read loop that never checks done is still reported" */
    it("reports a read loop whose exit is not the stream ending, on its line", () => {
      const found = report(`export async function drain(reader: Reader) {
  while (true) {
    const { done, value } = await reader.read();
    if (value === SENTINEL) break;
  }
}`);

      expect(found.map((entry) => [entry.messageId, entry.line])).toEqual([["unboundedLoop", 2]]);
    });
  });

  describe("when the module is a test", () => {
    it("reports nothing", () => {
      const found = report("for (;;) { if (done()) break; }", TEST);

      expect(found).toEqual([]);
    });
  });
});
