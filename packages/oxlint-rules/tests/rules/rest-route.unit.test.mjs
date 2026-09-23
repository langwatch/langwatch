import { afterAll, describe, expect, it } from "vitest";

import { PUBLISHED_WIRE } from "../../src/rules/rest-route-published.mjs";
import { restRouteRule } from "../../src/rules/rest-route.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const FEATURES = { agent: { layoutVersion: 0, roles: { contract: {}, process: {} } } };
const PUBLISHED = {
  paths: {
    "/api/agents/{id}": { get: {}, parameters: [] },
    "/api/v1/agents/{id}/runs": { get: {} },
    "/api/agents/{agentId}/traces": { get: {} },
    "/api/scim/v2/Users/{id}": { get: {} },
    "/api/agents/{id}/share": { post: {} },
  },
};

const workspace = createFixtureWorkspace({
  features: FEATURES,
  files: { [PUBLISHED_WIRE]: JSON.stringify(PUBLISHED) },
});
const unpublished = createFixtureWorkspace({ features: FEATURES });

afterAll(() => {
  workspace.cleanup();
  unpublished.cleanup();
});

const TRANSPORT = "modules/agent/process/src/transport/agent.rest.ts";
const HEAD = 'export const agentRest = defineRestRouter(AgentApi)\n  .withNamespace("agents")\n';

/** Runs the rule and keeps each finding's column beside its line. */
function report(code, filename = TRANSPORT, cwd = workspace.cwd) {
  const columns = [];
  const located = {
    meta: restRouteRule.meta,
    create(context) {
      const report = (descriptor) => {
        columns.push(descriptor.node.loc.start.column);
        context.report(descriptor);
      };

      return restRouteRule.create(Object.create(context, { report: { value: report } }));
    },
  };

  return runRule(located, { code, cwd, filename }).map((finding, index) => ({
    ...finding,
    column: columns[index],
  }));
}

function route(...lines) {
  return HEAD + lines.map((line) => `  ${line}\n`).join("");
}

function where(found) {
  return found
    .map(({ messageId, line, column }) => ({ messageId, line, column }))
    .toSorted((left, right) => left.line - right.line || left.column - right.column);
}

describe("given a route that declares its whole wire", () => {
  /** @scenario "A fully declared JSON route is compliant" */
  it("reports nothing", () => {
    const found = report(
      route(
        '.post("/agents", "createAgent")',
        ".withInput(createAgentSchema)",
        '.withPermission("agents:manage")',
        ".withOutput(agentSchema)",
        ".handle(({ app, input }) => app.createAgent(input));",
      ),
    );

    expect(found).toEqual([]);
  });
});

describe("given a route that declares no answer", () => {
  /** @scenario "A route with no declared answer is reported at its method" */
  it("reports missingOutput on the route's method, naming method and path", () => {
    const found = report(
      route(
        '.get("/agents/:agentId", "getAgent")',
        ".withParams(agentParamsSchema)",
        '.withPermission("agents:view")',
        ".handle(({ app, input }) => app.getAgent(input));",
      ),
    );

    expect(where(found)).toEqual([{ messageId: "missingOutput", line: 3, column: 3 }]);
    expect(found[0].data.operation).toBe("GET /agents/:agentId");
  });

  describe("when the router declares several routes", () => {
    /** @scenario "Each route of one router is reported on its own line" */
    it("reports each route at its own method, never the router head", () => {
      const found = report(
        route(
          '.get("/agents", "listAgents")',
          '.withPermission("agents:view")',
          ".handle(({ app }) => app.listAgents())",
          '.delete("/agents/:agentId", "deleteAgent")',
          ".withParams(agentParamsSchema)",
          '.withPermission("agents:manage")',
          ".handle(async ({ app, input }) => { await app.deleteAgent(input); });",
        ),
      );

      expect(where(found)).toEqual([
        { messageId: "missingOutput", line: 3, column: 3 },
        { messageId: "missingOutput", line: 6, column: 3 },
      ]);
    });
  });

  describe("when the handler is passed by reference", () => {
    /** @scenario "A handler passed by reference is judged by the declaration alone" */
    it("reports nothing for a declared route", () => {
      const found = report(
        route(
          '.get("/agents", "listAgents")',
          '.withPermission("agents:view")',
          ".withOutput(agentListSchema)",
          ".handle(listAgents);",
        ),
      );

      expect(found).toEqual([]);
    });
  });

  describe("when it declares responds() or withResponse()", () => {
    /** @scenario "responds() and withResponse() count as a declared answer" */
    it("reports nothing", () => {
      const found = report(
        route(
          '.get("/health", "agentHealth")',
          '.withPermission("agents:view")',
          ".responds({ 200: reportSchema, 503: reportSchema })",
          ".handle(({ app }) => app.health())",
          '.post("/agents/export", "exportAgents")',
          '.withPermission("agents:view")',
          '.withResponse("bytes", { produces: "text/csv" })',
          '.handle(({ app, response }) => response.stream(app.exportAgents(), { mediaType: "text/csv" }));',
        ),
      );

      expect(found).toEqual([]);
    });
  });

  describe("when it is a publicRoute", () => {
    /** @scenario "A publicRoute is exempt from the declared input and answer" */
    it("reports nothing, also through a const-bound access", () => {
      const found = report(
        'const DOOR = publicRoute({ reason: "webhook" });\n' +
          route(
            '.post("/webhook", "receiveWebhook")',
            '.withAccess(publicRoute({ reason: "webhook" }))',
            ".handle(({ app, input }) => app.receive(input))",
            '.post("/webhook/retry", "retryWebhook")',
            ".withAccess(DOOR)",
            ".handle(({ app, input }) => app.retry(input));",
          ),
      );

      expect(found).toEqual([]);
    });
  });
});

describe("given a body-carrying route", () => {
  describe("when it declares no input", () => {
    /** @scenario "A body-carrying route missing its input is reported at its method" */
    it("reports missingInput on the route's method", () => {
      const found = report(
        route(
          '.post("/agents", "createAgent")',
          '.withPermission("agents:manage")',
          ".withOutput(agentSchema)",
          ".handle(({ app }) => app.createAgent());",
        ),
      );

      expect(where(found)).toEqual([{ messageId: "missingInput", line: 3, column: 3 }]);
      expect(found[0].message).toContain(
        "Add `.withInput(<schema>)` from the module's own contract; an action that takes no body declares an empty input schema there.",
      );
    });
  });

  describe("when it declares withRawBody instead", () => {
    /** @scenario "A body declared through withRawBody satisfies the input" */
    it("reports nothing", () => {
      const found = report(
        route(
          '.post("/agents/import", "importAgents")',
          '.withRawBody("text")',
          '.withPermission("agents:manage")',
          ".withOutput(importSchema)",
          ".handle(({ app, raw }) => app.importAgents(raw));",
        ),
      );

      expect(found).toEqual([]);
    });
  });
});

describe("given a route answering through withRawResponse", () => {
  /** @scenario "withRawResponse is one finding on the call" */
  it("reports rawResponse once, on withRawResponse, and nothing about its handler", () => {
    const found = report(
      route(
        '.post("/agents/export", "exportAgents")',
        '.withPermission("agents:view")',
        '.withRawResponse({ produces: "text/csv" })',
        '.handle(() => new Response("bytes", { status: 400 }));',
      ),
    );

    expect(where(found)).toEqual([{ messageId: "rawResponse", line: 5, column: 3 }]);
  });
});

describe("given a declared route whose handler builds its own answer", () => {
  const declared = (handler) =>
    route(
      '.get("/agents", "listAgents")',
      '.withPermission("agents:view")',
      ".withOutput(agentListSchema)",
      handler,
    );

  /** @scenario "A handler building its own answer is reported where it builds it" */
  it.each([
    ['.handle(({ c }) => c.json({ error: "bad" }, 400));', "c.json", "c.json(...)"],
    ['.handle((args) => args.c.json({ error: "bad" }, 400));', "args.c", "args.c.json(...)"],
    ['.handle(() => Response.json({ error: "bad" }));', "Response", "Response.json(...)"],
    ['.handle(() => new Response("nope", { status: 400 }));', "new", "new Response(...)"],
    ['.handle(() => jsonAnswer({ error: "bad" }, 400));', "jsonAnswer", "jsonAnswer(...)"],
    [".handle(() => { throw new HTTPException(400); });", "new", "new HTTPException(...)"],
    [".handle(() => { return { status: 404, body: {} }; });", "{ status", "{ status: 404 }"],
  ])("reports manualAnswer for %s", (handler, builder, symbol) => {
    const found = report(declared(handler));

    const column = "  ".length + handler.indexOf(builder);
    expect(where(found)).toEqual([{ messageId: "manualAnswer", line: 6, column }]);
    expect(found[0].data.symbol).toBe(symbol);
  });

  /** @scenario "A refusal status bound to a const is still a hand-built answer" */
  it("reports a refusal status held in a const", () => {
    const found = report(
      "const NOT_FOUND = 404;\n" +
        declared('.handle(() => ({ status: NOT_FOUND, body: { message: "gone" } }));'),
    );

    expect(where(found)).toEqual([{ messageId: "manualAnswer", line: 7, column: 17 }]);
    expect(found[0].data.symbol).toBe("{ status: NOT_FOUND }");
  });

  /** @scenario "A declared status answer under responds() is not a hand-built answer" */
  it("reports nothing for a status the route declares through responds()", () => {
    const found = report(
      route(
        '.get("/agents/:agentId", "getAgent")',
        ".withParams(agentParamsSchema)",
        '.withPermission("agents:view")',
        ".responds({ 200: agentSchema, 404: missingSchema })",
        ".handle(() => ({ status: 404, body: { missing: true } }));",
      ),
    );

    expect(found).toEqual([]);
  });
});

describe("given a route path parameter", () => {
  /** @scenario "A bare path parameter is reported on the path" */
  it("reports pathParam on the path literal with the entity's name", () => {
    const found = report(
      route(
        '.get("/virtual-keys/:id", "getVirtualKey")',
        ".withParams(keyParamsSchema)",
        '.withPermission("agents:view")',
        ".withOutput(keySchema)",
        ".handle(({ app, input }) => app.getKey(input));",
      ),
    );

    expect(where(found)).toEqual([{ messageId: "pathParam", line: 3, column: 7 }]);
    expect(found[0].data.suggestion).toBe("virtualKeyId");
  });
});

describe("given a bare path parameter on a route main already publishes", () => {
  const read = (path, method = "get") =>
    route(
      `.${method}("${path}", "readAgent")`,
      ".withParams(agentParamsSchema)",
      '.withPermission("agents:view")',
      ".withOutput(agentSchema)",
      ".handle(({ app, input }) => app.getAgent(input));",
    );

  /** @scenario "A route main already publishes keeps its parameter names" */
  it("reports nothing for the route itself or through its /api/v1 twin", () => {
    expect(report(read("/:id"))).toEqual([]);
    expect(report(read("/:id/runs"))).toEqual([]);
  });

  /** @scenario "A route main already publishes keeps its parameter names" */
  it("resolves the family's addressing and generation before matching", () => {
    const scim =
      'export const scimRest = defineRestRouter(ScimApi)\n  .withNamespace("scim")\n' +
      '  .withVersion(V)\n  .withAddressing("v1-in-path", { generation: "v2" })\n' +
      '  .get("/Users/:id", "getUser").withOutput(userSchema).handle(({ app }) => app.get());\n';
    const literal =
      'export const legacyRest = defineRestRouter(AgentApi)\n  .withNamespace("legacy")\n' +
      '  .withVersion(V)\n  .withAddressing("literal", { v1Twin: false })\n' +
      '  .post("/api/agents/:id/share", "share").withInput(s).withOutput(s).handle(({ app }) => app.share());\n';

    expect(report(scim)).toEqual([]);
    expect(report(literal)).toEqual([]);
  });

  /** @scenario "A new route with a bare parameter is still reported" */
  it("reports a path, a method or a parameter name main does not publish", () => {
    const found = [
      ...report(read("/:id/photo")),
      ...report(read("/:id", "delete")),
      ...report(read("/:id/traces")),
    ];

    expect(where(found)).toEqual([
      { messageId: "pathParam", line: 3, column: 7 },
      { messageId: "pathParam", line: 3, column: 7 },
      { messageId: "pathParam", line: 3, column: 10 },
    ]);
  });

  /** @scenario "Every other rest-route check still fires on a published route" */
  it("reports the missing answer on a published route", () => {
    const found = report(route('.get("/:id", "readAgent")', ".handle(({ app }) => app.get());"));

    expect(where(found)).toEqual([{ messageId: "missingOutput", line: 3, column: 3 }]);
  });

  /** @scenario "A missing published wire document fails the run by name" */
  it("throws naming the document instead of passing every route", () => {
    expect(() => report(read("/:id"), TRANSPORT, unpublished.cwd)).toThrow(
      "docs/api-reference/openapiLangWatch.json",
    );
  });
});

describe("given a route's wire schemas", () => {
  /** @scenario "A wire schema from another module's contract is reported where it is used" */
  it("reports foreignContract on the schema, not on the import", () => {
    const found = report(
      'import { traceSchema, type TraceApi } from "@langwatch/trace-contract";\n' +
        'import { agentParamsSchema } from "@langwatch/agent-contract";\n' +
        route(
          '.get("/agents/:agentId/trace", "getAgentTrace")',
          ".withParams(agentParamsSchema)",
          '.withPermission("agents:view")',
          ".withOutput(z.object({ trace: traceSchema }))",
          ".handle(({ app, input }) => app.getTrace(input));",
        ),
    );

    expect(where(found)).toEqual([{ messageId: "foreignContract", line: 8, column: 32 }]);
    expect(found[0].data.source).toBe("@langwatch/trace-contract");
  });
});

describe("given a file that is not a REST transport", () => {
  /** @scenario "Only REST transport files are judged" */
  it("reports nothing", () => {
    const found = report(
      route('.get("/agents", "listAgents")', ".handle(({ c }) => c.json({}));"),
      "modules/agent/process/src/services/agent.service.ts",
    );

    expect(found).toEqual([]);
  });
});
