import { afterAll, describe, expect, it } from "vitest";
import { refusalIsAHandledErrorRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { server: {} } } },
});

afterAll(() => workspace.cleanup());

const TRANSPORT = "modules/agent/server/src/transport/agent.rest.ts";

function report(code, filename = TRANSPORT) {
  return runRule(refusalIsAHandledErrorRule, { code, cwd: workspace.cwd, filename });
}

describe("given a transport that refuses a caller", () => {
  describe("when it answers a status and a body itself", () => {
    /** @scenario "A refusal carries a code the client can key on" */
    it("reports handWrittenRefusal", () => {
      const found = report('export const deny = (c) => c.json({ error: "nope" }, 401);');

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("handWrittenRefusal");
      expect(found[0].message).toContain("HandledError");
    });
  });

  describe("when it returns a refusal as a result object", () => {
    /** @scenario "A refusal carries a code the client can key on" */
    it("reports handWrittenRefusal naming the shape", () => {
      const found = report(
        "export const resolve = () => ({ ok: false, status: 401, body: { message: 'no' } });",
      );

      expect(found[0].data.shape).toBe("ok: false");
    });
  });

  describe("when it answers a success, or throws instead", () => {
    /** @scenario "A refusal carries a code the client can key on" */
    it("reports nothing", () => {
      expect(report('export const ok = (c) => c.json({ items: [] }, 200);')).toHaveLength(0);
      expect(
        report("export const deny = () => { throw new MissingCredentialsError(); };"),
      ).toHaveLength(0);
      expect(report("export const shape = { ok: true, status: 200, body: {} };")).toHaveLength(0);
    });
  });
});
