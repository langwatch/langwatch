import { afterAll, describe, expect, it } from "vitest";
import { restHandlerThrowsRule } from "../../src/rules/rest-handler-throws.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { contract: {}, process: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename = "modules/agent/process/src/transport/agent.rest.ts") {
  return runRule(restHandlerThrowsRule, { code, cwd: workspace.cwd, filename });
}

describe("given a standard JSON route's handler", () => {
  describe("when it returns the plain result and throws for failure", () => {
    /** @scenario "A handler that returns plainly and throws is compliant" */
    it("reports nothing", () => {
      const found = report(
        'router.post("/agents", "createAgent").withInput(createSchema).withOutput(agentSchema)' +
          ".handle(({ app, input }) => {\n" +
          "  if (!input.name) throw new InvalidAgentConfigError(\"name is required\");\n" +
          "  return app.createAgent(input);\n" +
          "});",
      );

      expect(found).toEqual([]);
    });
  });

  describe("when it calls jsonAnswer", () => {
    /** @scenario "A handler calling jsonAnswer is reported" */
    it("reports manualAnswer", () => {
      const found = report(
        'router.post("/agents", "createAgent").withInput(createSchema).withOutput(agentSchema)' +
          '.handle(() => jsonAnswer({ error: "bad" }, 400));',
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["manualAnswer"]);
      expect(found[0].data.symbol).toBe("jsonAnswer(...)");
    });
  });

  describe("when it calls c.json", () => {
    /** @scenario "A handler calling c.json is reported" */
    it("reports manualAnswer", () => {
      const found = report(
        'router.post("/agents", "createAgent").withInput(createSchema).withOutput(agentSchema)' +
          '.handle(({ c }) => c.json({ error: "bad" }, 400));',
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["manualAnswer"]);
      expect(found[0].data.symbol).toBe("c.json(...)");
    });
  });

  describe("when it constructs a raw Response", () => {
    /** @scenario "A handler constructing a raw Response is reported" */
    it("reports manualAnswer", () => {
      const found = report(
        'router.post("/agents", "createAgent").withInput(createSchema).withOutput(agentSchema)' +
          '.handle(() => new Response("nope", { status: 400 }));',
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["manualAnswer"]);
      expect(found[0].data.symbol).toBe("new Response(...)");
    });
  });

  describe("when it constructs an HTTPException", () => {
    /** @scenario "A handler constructing an HTTPException is reported" */
    it("reports manualAnswer", () => {
      const found = report(
        'router.post("/agents", "createAgent").withInput(createSchema).withOutput(agentSchema)' +
          '.handle(() => { throw new HTTPException(400, { message: "bad" }); });',
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["manualAnswer"]);
      expect(found[0].data.symbol).toBe("new HTTPException(...)");
    });
  });

  describe("when a nested closure inside the handler builds its own answer", () => {
    /** @scenario "A manual answer nested inside the handler is still reported" */
    it("reports manualAnswer", () => {
      const found = report(
        'router.post("/agents", "createAgent").withInput(createSchema).withOutput(agentSchema)' +
          ".handle(async ({ app }) => {\n" +
          "  const fallback = () => jsonAnswer({ error: \"bad\" }, 500);\n" +
          "  return app.createAgent() ?? fallback();\n" +
          "});",
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["manualAnswer"]);
    });
  });
});

describe("given a route escaped through withRawResponse", () => {
  /** @scenario "A withRawResponse handler answering with its own Response is not this rule's business" */
  it("reports nothing even when it constructs a raw Response", () => {
    const found = report(
      'router.post("/export", "downloadExport").withRawBody("text")' +
        '.withRawResponse({ produces: ["application/octet-stream"] })' +
        '.handle(() => new Response("bytes", { status: 200 }));',
    );

    expect(found).toEqual([]);
  });
});

describe("given a route escaped through publicRoute", () => {
  /** @scenario "A publicRoute handler answering with c.json is not this rule's business" */
  it("reports nothing even when it calls c.json", () => {
    const found = report(
      'router.post("/webhook", "receiveWebhook").withAccess(publicRoute({ reason: "webhook" }))' +
        '.handle(({ c }) => c.json({ ok: true }));',
    );

    expect(found).toEqual([]);
  });
});
