import { afterAll, describe, expect, it } from "vitest";
import { restDeclaresItsAnswerRule } from "../../src/rules/rest-declares-its-answer.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { roles: { contract: {}, process: {} } } },
});

afterAll(() => workspace.cleanup());

function report(code, filename = "modules/agent/process/src/transport/agent.rest.ts") {
  return runRule(restDeclaresItsAnswerRule, { code, cwd: workspace.cwd, filename });
}

describe("given a route that declares its response kind", () => {
  /** @scenario "A route producing its declared kind through the response argument is compliant" */
  it("reports nothing", () => {
    const found = report(
      'router.get("/agents/:id/export", "exportAgent").withResponse("bytes", { produces: "application/octet-stream" })' +
        ".handle(({ response }) => response.bytes(buffer));",
    );

    expect(found).toEqual([]);
  });
});

describe("given a handler that constructs a raw Response", () => {
  /** @scenario "A handler constructing a raw Response is reported as manualResponse" */
  it("reports manualResponse", () => {
    const found = report(
      'router.get("/agents", "listAgents").withOutput(agentListSchema)' +
        '.handle(() => new Response("nope", { status: 400 }));',
    );

    expect(found.map((entry) => entry.messageId)).toEqual(["manualResponse"]);
    expect(found[0].data.operation).toBe("listAgents");
  });

  /** @scenario "A handler constructing a raw Response is reported even when a kind is declared" */
  it("reports manualResponse even when withResponse is declared", () => {
    const found = report(
      'router.get("/agents/:id/export", "exportAgent").withResponse("bytes", { produces: "application/octet-stream" })' +
        '.handle(() => new Response(buffer, { status: 200 }));',
    );

    expect(found.map((entry) => entry.messageId)).toEqual(["manualResponse"]);
  });
});

describe("given a handler that calls c.json without declaring a kind", () => {
  /** @scenario "A handler calling c.json without a declared kind is reported as undeclaredAnswer" */
  it("reports undeclaredAnswer", () => {
    const found = report(
      'router.post("/agents", "createAgent").withOutput(agentSchema)' +
        '.handle(({ c }) => c.json({ error: "bad" }, 400));',
    );

    expect(found.map((entry) => entry.messageId)).toEqual(["undeclaredAnswer"]);
    expect(found[0].data.operation).toBe("createAgent");
  });
});

describe("given a handler that returns a raw { status, headers, body } literal", () => {
  /** @scenario "A handler returning a raw status/headers/body literal without a declared kind is reported as undeclaredAnswer" */
  it("reports undeclaredAnswer", () => {
    const found = report(
      'router.get("/agents/:id/avatar", "getAgentAvatar").withOutput(agentSchema)' +
        ".handle(() => {\n" +
        '  return { status: 200, headers: {}, body: buffer };\n' +
        "});",
    );

    expect(found.map((entry) => entry.messageId)).toEqual(["undeclaredAnswer"]);
  });
});

describe("given a route escaped through withRawResponse", () => {
  /** @scenario "A withRawResponse route is reported as rawResponseHatch" */
  it("reports rawResponseHatch", () => {
    const found = report(
      'router.post("/export", "downloadExport").withRawBody("text")' +
        '.withRawResponse({ produces: ["application/octet-stream"] })' +
        '.handle(() => ({ status: 200, headers: {}, body: "bytes" }));',
    );

    expect(found.map((entry) => entry.messageId)).toEqual(["rawResponseHatch"]);
    expect(found[0].data.operation).toBe("downloadExport");
  });
});

describe("given an import of the framework's own envelope helpers", () => {
  /** @scenario "Importing jsonResponse or rateLimitedResponse from @langwatch/api/rest is reported as canonicalEnvelope" */
  it("reports canonicalEnvelope for jsonResponse", () => {
    const found = report('import { jsonResponse } from "@langwatch/api/rest";');

    expect(found.map((entry) => entry.messageId)).toEqual(["canonicalEnvelope"]);
    expect(found[0].data.name).toBe("jsonResponse");
  });

  it("reports canonicalEnvelope for rateLimitedResponse", () => {
    const found = report('import { rateLimitedResponse } from "@langwatch/api/rest";');

    expect(found.map((entry) => entry.messageId)).toEqual(["canonicalEnvelope"]);
    expect(found[0].data.name).toBe("rateLimitedResponse");
  });
});

describe("given the framework's own response-writing source", () => {
  /** @scenario "The REST framework's own response-writing source is not this rule's business" */
  it("reports nothing even in packages/api/src/rest itself", () => {
    const found = report(
      'export function jsonResponse() { return new Response(JSON.stringify({}), { status: 200 }); }',
      "packages/api/src/rest/response.ts",
    );

    expect(found).toEqual([]);
  });

  it("reports nothing in the canonical error boundary", () => {
    const found = report(
      "export function apiCanonicalError() { return new Response(\"error\", { status: 500 }); }",
      "apps/api/src/app/api-canonical-error.ts",
    );

    expect(found).toEqual([]);
  });
});
