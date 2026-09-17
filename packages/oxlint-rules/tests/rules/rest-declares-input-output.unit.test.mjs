import { afterAll, describe, expect, it } from "vitest";
import { restDeclaresInputOutputRule } from "../../src/rules/rest-declares-input-output.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { contract: {}, server: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename = "modules/agent/server/src/transport/agent.rest.ts") {
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

  describe("when it declares no answer at all", () => {
    /** @scenario "A route with no declared answer is reported" */
    it("reports missingOutput", () => {
      const found = report('router.get("/agents/:id", "getAgent").withPermission("agent:view").handle(() => {});');

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

  describe("when it declares withOutput but not withInput", () => {
    /** @scenario "A POST route missing withInput is reported" */
    it("reports missingInput", () => {
      const found = report(
        'router.post("/agents", "createAgent").withPermission("agent:create").withOutput(agentSchema)' +
          ".handle(() => {});",
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["missingInput"]);
    });
  });

  describe("when it declares withRawBody instead of withInput", () => {
    /** @scenario "A POST route declaring withRawBody is not missing its input" */
    it("reports nothing", () => {
      const found = report(
        'router.post("/agents", "createAgent").withRawBody("text").withPermission("agent:create")' +
          ".withOutput(agentSchema).handle(() => {});",
      );

      expect(found).toEqual([]);
    });
  });

  describe("when it declares neither withInput nor withOutput", () => {
    /** @scenario "A route missing both withInput and withOutput is reported twice" */
    it("reports missingOutput and missingInput", () => {
      const found = report('router.post("/agents", "createAgent").withPermission("agent:create").handle(() => {});');

      expect(found.map((entry) => entry.messageId).toSorted()).toEqual(["missingInput", "missingOutput"]);
    });
  });
});

describe("given a route escaped through publicRoute", () => {
  /** @scenario "A publicRoute escape is exempt from withInput and withOutput" */
  it("reports nothing even with no declared answer", () => {
    const found = report(
      'router.post("/webhook", "receiveWebhook").withAccess(publicRoute({ reason: "webhook" }))' +
        ".withRawResponse({ produces: [\"application/json\"] }).handle(() => {});",
    );

    expect(found).toEqual([]);
  });
});

describe("given a route escaped through withRawResponse alone", () => {
  /** @scenario "A withRawResponse escape is exempt from withInput and withOutput" */
  it("reports nothing", () => {
    const found = report(
      'router.get("/download", "downloadReport").withPermission("agent:view")' +
        ".withRawResponse({ produces: [\"text/csv\"] }).handle(() => {});",
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
