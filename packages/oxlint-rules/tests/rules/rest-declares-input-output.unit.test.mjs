import { afterAll, describe, expect, it } from "vitest";

import { restDeclaresInputOutputRule } from "../../src/rules/rest-declares-input-output.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { contract: {}, process: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename = "modules/agent/process/src/transport/agent.rest.ts") {
  return runRule(restDeclaresInputOutputRule, { code, cwd: workspace.cwd, filename });
}

describe("given a GET route", () => {
  describe("when it declares withOutput", () => {
    /** @scenario "A GET route with withOutput and no body is compliant" */
    it("reports nothing", () => {
      const found = report(
        'router.get("/agents/:id", "getAgent").withParams(idSchema).withPermission("agent:view")' +
          ".withOutput(agentSchema).handle(() => {});",
      );

      expect(found).toEqual([]);
    });
  });

  describe("when it declares no answer and its handler returns nothing", () => {
    /** @scenario "A no-content route is compliant" */
    it("reports nothing", () => {
      const found = report(
        'router.get("/agents/:id/ping", "pingAgent").withParams(idSchema).withPermission("agent:view")' +
          ".handle(async ({ app, input }) => { await app.ping(input.id); });",
      );

      expect(found).toEqual([]);
    });
  });

  describe("when it declares no answer but its handler returns one", () => {
    /** @scenario "A route with no declared answer is reported" */
    it("reports missingOutput", () => {
      const found = report(
        'router.get("/agents/:id", "getAgent").withPermission("agent:view")' +
          '.handle(() => ({ id: "agent-1" }));',
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["missingOutput"]);
      expect(found[0].data.operation).toBe("getAgent");
    });
  });
});

describe("given a POST route", () => {
  describe("when it declares both withInput and withOutput", () => {
    /** @scenario "A POST route with both withInput and withOutput is compliant" */
    it("reports nothing", () => {
      const found = report(
        'router.post("/agents", "createAgent").withInput(createSchema).withPermission("agent:create")' +
          ".withOutput(agentSchema).handle(() => {});",
      );

      expect(found).toEqual([]);
    });
  });

  describe("when it declares withInput but no withOutput, and answers with nothing", () => {
    /** @scenario "A route with input but no declared output is compliant when it answers with nothing" */
    it("reports nothing", () => {
      const found = report(
        'router.post("/agents/:id/archive", "archiveAgent").withInput(archiveSchema)' +
          '.withPermission("agent:manage").handle(async ({ app, input }) => { await app.archive(input); });',
      );

      expect(found).toEqual([]);
    });
  });

  describe("when it declares neither withInput nor withOutput, and answers with nothing", () => {
    /** @scenario "A no-content, no-argument route is compliant" */
    it("reports nothing", () => {
      const found = report(
        'router.post("/agents/sweep", "sweepAgents").withPermission("agent:manage")' +
          ".handle(async ({ app }) => { await app.sweep(); });",
      );

      expect(found).toEqual([]);
    });
  });

  describe("when it declares withRawBody and answers with nothing", () => {
    /** @scenario "A POST route declaring withRawBody with no answer is compliant" */
    it("reports nothing", () => {
      const found = report(
        'router.post("/agents/import", "importAgent").withRawBody("text").withPermission("agent:create")' +
          ".handle(async ({ app, raw }) => { await app.import(raw); });",
      );

      expect(found).toEqual([]);
    });
  });

  describe("when it declares neither withInput nor withOutput but its handler returns one", () => {
    /** @scenario "A route missing withOutput is reported even with no declared input" */
    it("reports missingOutput", () => {
      const found = report(
        'router.post("/agents", "createAgent").withPermission("agent:create")' +
          '.handle(() => ({ id: "agent-1" }));',
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["missingOutput"]);
    });
  });
});

describe("given a DELETE route", () => {
  describe("when it declares withParams but neither withInput nor withOutput, and answers with nothing", () => {
    /** @scenario "A no-content DELETE with a params source is compliant" */
    it("reports nothing", () => {
      const found = report(
        'router.delete("/agents/:id", "deleteAgent").withParams(idSchema).withPermission("agent:manage")' +
          ".handle(async ({ app, input }) => { await app.delete({ id: input.id }); });",
      );

      expect(found).toEqual([]);
    });
  });
});

describe("given a route escaped through publicRoute", () => {
  /** @scenario "A publicRoute escape is exempt from withOutput" */
  it("reports nothing even with no declared answer", () => {
    const found = report(
      'router.post("/webhook", "receiveWebhook").withAccess(publicRoute({ reason: "webhook" }))' +
        '.withRawResponse({ produces: ["application/json"] }).handle(() => {});',
    );

    expect(found).toEqual([]);
  });
});

describe("given a route escaped through withRawResponse alone", () => {
  /** @scenario "A withRawResponse escape is exempt from withOutput" */
  it("reports nothing", () => {
    const found = report(
      'router.get("/download", "downloadReport").withPermission("agent:view")' +
        '.withRawResponse({ produces: ["text/csv"] }).handle(() => {});',
    );

    expect(found).toEqual([]);
  });
});

describe("given several routes declared on the same call site", () => {
  /** @scenario "responds() counts as a declared answer" */
  it("treats responds() as a declared answer", () => {
    const found = report(
      'router.get("/health", "readHealth").withPermission("ops:view")' +
        ".responds({ 200: okSchema, 503: okSchema }).handle(() => {});",
    );

    expect(found).toEqual([]);
  });
});
