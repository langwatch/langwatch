import { afterAll, describe, expect, it } from "vitest";

import { refusalIsAHandledErrorRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {} } } },
});

afterAll(() => workspace.cleanup());

const TRANSPORT = "modules/agent/process/src/transport/agent.rest.ts";

function report(code, filename = TRANSPORT) {
  return runRule(refusalIsAHandledErrorRule, { code, cwd: workspace.cwd, filename });
}

describe("given a transport that refuses a caller", () => {
  describe("when a REST handler answers a status and a body itself", () => {
    /** @scenario "A hand-built REST answer is left to rest-route" */
    it("reports nothing, because rest-route reports it once", () => {
      expect(report('export const deny = (c) => c.json({ error: "nope" }, 401);')).toEqual([]);
    });
  });

  describe("when it returns a refusal as a result object", () => {
    /** @scenario "A refusal carries a code the client can key on" */
    it("reports handWrittenRefusal naming the shape", () => {
      const found = report(
        "export const resolve = () => ({ ok: false, status: 401, body: { message: 'no' } });",
      );

      expect(found.map(({ messageId, line }) => ({ messageId, line }))).toEqual([
        { messageId: "handWrittenRefusal", line: 1 },
      ]);
      expect(found[0].data.shape).toBe("ok: false");
      expect(found[0].message).toContain("HandledError");
    });
  });

  describe("when it answers a success, or throws instead", () => {
    /** @scenario "A success result or a thrown error is not a refusal" */
    it("reports nothing", () => {
      expect(report("export const ok = (c) => c.json({ items: [] }, 200);")).toHaveLength(0);
      expect(
        report("export const deny = () => { throw new MissingCredentialsError(); };"),
      ).toHaveLength(0);
      expect(report("export const shape = { ok: true, status: 200, body: {} };")).toHaveLength(0);
    });
  });
});
