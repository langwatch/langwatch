import { afterAll, describe, expect, it } from "vitest";

import { transportDeclaresRule } from "../../src/rules/transport-declares.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});

afterAll(() => workspace.cleanup());

const TRANSPORT = "modules/widget/process/src/transport/widget.api.ts";
const REST_FAMILY = "modules/widget/process/src/transport/api-rest/widget.api.ts";
const TRPC_FAMILY = "modules/widget/process/src/transport/api-trpc/widget.api.ts";
const SERVICE = "modules/widget/process/src/services/widget.service.ts";

function report(code, filename = TRANSPORT) {
  return runRule(transportDeclaresRule, { code, cwd: workspace.cwd, filename });
}

function found(code, filename) {
  return report(code, filename).map(({ line, messageId }) => [messageId, line]);
}

describe("given route families declared through the framework", () => {
  /** @scenario "A transport file defined through the framework passes" */
  it("reports nothing for a REST family or a tRPC family", () => {
    const rest = [
      'import { defineRestRouter } from "@langwatch/api/rest";',
      'export const widgetRest = defineRestRouter({ name: "widgets" }).get("/", "2026-09-01", (endpoint) =>',
      '  endpoint.withInput(schema).withOutput(schema).withPermission("widget:view").handle(async ({ input, app }) => app.widgets.get(input)),',
      ");",
    ].join("\n");
    const trpc = [
      'import { defineTrpcRouter } from "@langwatch/api/trpc";',
      'export const widgetTrpc = defineTrpcRouter().query("get", (p) =>',
      '  p.withInput(schema).withOutput(schema).withPermission("widget:view").handle(async ({ input }) => input),',
      ");",
    ].join("\n");

    expect(report(rest, REST_FAMILY)).toEqual([]);
    expect(report(trpc, TRPC_FAMILY)).toEqual([]);
  });
});

describe("given a REST family that reaches for the HTTP framework underneath", () => {
  /** @scenario "A REST transport file that hand-rolls its routes is refused" */
  it("reports hono-openapi's door, the zod validator and its own Hono app, each on its line", () => {
    const code = [
      'import { Hono } from "hono";',
      'import { describeRoute, resolver, validator } from "hono-openapi";',
      'import { zValidator } from "@hono/zod-validator";',
      "const app = new Hono();",
    ].join("\n");

    expect(found(code, REST_FAMILY)).toEqual([
      ["openapiDoorImport", 2],
      ["zodValidatorImport", 3],
      ["rawApp", 4],
    ]);
    expect(report(code, REST_FAMILY)[0].data).toEqual({
      names: "describeRoute, resolver, validator",
      specifier: "hono-openapi",
    });
  });

  it("reads the module's own `<feature>.rest.ts` as a REST family", () => {
    const code = 'import { Hono } from "hono";\nexport const app = new Hono();';

    expect(found(code, "modules/widget/process/src/transport/widget.rest.ts")).toEqual([
      ["rawApp", 2],
    ]);
  });
});

describe("given a tRPC family that builds its own router", () => {
  /** @scenario "A tRPC transport file that builds a bare router is refused" */
  it("reports the second root, the bare router and the parser applied outside the chain", () => {
    const code = [
      'import { initTRPC } from "@trpc/server";',
      "const trpc = initTRPC.context().create();",
      "export const router = trpc.router({",
      '  get: policy("project:view")(procedure.input(schema)).query(handler),',
      "});",
    ].join("\n");

    expect(found(code, TRPC_FAMILY)).toEqual([
      ["trpcRoot", 1],
      ["trpcRoot", 2],
      ["bareRouter", 3],
      ["trpcInput", 4],
    ]);
  });
});

describe("given a transport that still gates on a role", () => {
  /** @scenario "A transport file that names the legacy RBAC vocabulary is refused" */
  it("reports the role module and each legacy identifier it uses", () => {
    const code = [
      'import { checkUserPermissionForProject } from "~/server/api/permission";',
      'import { TeamRoleGroup } from "../../rbac/groups";',
      "export const guard = () => checkUserPermissionForProject(TeamRoleGroup.PROJECT_VIEW);",
      "export const labels = { TeamRoleGroup: 1 };",
    ].join("\n");

    expect(found(code, TRPC_FAMILY)).toEqual([
      ["rbacImport", 2],
      ["legacyRbacName", 3],
      ["legacyRbacName", 3],
    ]);
  });
});

describe("given a module source outside the transport folder", () => {
  /** @scenario "The allowlist reached zero and the policy became a plain refusal" */
  it("still refuses composition imports, handler bindings and switched-off output checks", () => {
    const code = [
      'import { createTrpcHandlerBinding as bind } from "@langwatch/api";',
      'import * as api from "@langwatch/api";',
      'export * from "@langwatch/api/composition";',
      "const one = bind(root);",
      "const two = api.createTrpcHandlerBinding(root);",
      'const late = import("@langwatch/api/composition");',
      "export const options = { validateOutput: false };",
      "export const bypass = (p) => p.withoutOutput();",
    ].join("\n");

    expect(found(code, SERVICE)).toEqual([
      ["compositionImport", 3],
      ["handlerBindingCall", 4],
      ["handlerBindingCall", 5],
      ["compositionImport", 6],
      ["outputUnchecked", 7],
      ["outputUnchecked", 8],
    ]);
  });

  it("refuses a tRPC root created with initTRPC.context()", () => {
    const code =
      'import { initTRPC } from "@trpc/server";\nconst root = initTRPC.context().create();';

    expect(report(code, SERVICE)).toEqual([
      expect.objectContaining({
        messageId: "trpcRoot",
        line: 2,
        data: { call: "initTRPC.context()" },
      }),
    ]);
  });

  it("does not read `.handle(...)` in a source that declares no transport", () => {
    const code =
      "export function drain(queue) {\n  return queue.handle(async ({ ctx }) => ctx.req.headers);\n}";

    expect(report(code, SERVICE)).toEqual([]);
  });

  it("does not treat a similarly named contract import as the framework", () => {
    const code = [
      'import type { ApiKey } from "@langwatch/api-key-contract";',
      "export function drain(queue, key: ApiKey) {",
      "  return queue.handle(({ event }) => event);",
      "}",
    ].join("\n");

    expect(report(code, SERVICE)).toEqual([]);
  });
});

describe("given a handler that takes more than the framework hands it", () => {
  /** @scenario "A handler reaching the raw request is reported at the field it takes" */
  it("reports the destructured field on its own line and each raw access", () => {
    const code = [
      'import { defineTrpcRouter } from "@langwatch/api/trpc";',
      'export const router = defineTrpcRouter().query("get", (p) =>',
      "  p.withOutput(schema).handle(async (args) => {",
      "    const raw = args;",
      "    const { ctx } = args;",
      '    return [raw["ctx"], args.context, ctx.req];',
      "  }),",
      ");",
    ].join("\n");

    expect(found(code, SERVICE)).toEqual([
      ["rawContextField", 5],
      ["rawContextAccess", 6],
      ["rawContextAccess", 6],
      ["rawContextAccess", 6],
    ]);
  });

  it("reports a field of a multi-line parameter where the field is written", () => {
    const code = [
      'import { defineRestRouter } from "@langwatch/api/rest";',
      "async function record({",
      "  app,",
      "  raw,",
      "}) {",
      "  return app.events.record(raw);",
      "}",
      'export const rest = defineRestRouter().post("/", "2026-09-01", (e) => e.withInput(s).handle(record));',
    ].join("\n");

    expect(found(code, TRANSPORT)).toEqual([
      ["handlerNotInline", 8],
      ["rawContextField", 4],
    ]);
  });

  it("finds a named handler through an alias", () => {
    const code = [
      'import { defineRestRouter } from "@langwatch/api/rest";',
      "const handler = async (args) => {",
      "  const raw = args;",
      "  return raw.request;",
      "};",
      'export const router = defineRestRouter({ name: "x" }).get("/", (p) => p.handle(handler));',
    ].join("\n");

    expect(found(code, SERVICE)).toEqual([["rawContextAccess", 4]]);
  });

  it("accepts the whole framework context and a destructured input's own headers", () => {
    const code = [
      'import { defineTrpcRouter } from "@langwatch/api/trpc";',
      'export const router = defineTrpcRouter().query("x", (p) =>',
      "  p.handle(({ input, app, actor, scope, signal }) => app.x.get({ input, actor, scope, signal })),",
      ");",
    ].join("\n");

    expect(report(code, SERVICE)).toEqual([]);
  });
});

const REST_ROUTES = "modules/widget/process/src/transport/widget.rest.ts";
const ROUTER_HEAD = [
  'import { defineRestRouter } from "@langwatch/api/rest";',
  "export const widgetRest = defineRestRouter(WidgetApi)",
];

/** Each finding as messageId, line and column, the column read off the reported node. */
function located(...routeLines) {
  const columns = [];
  const probe = {
    meta: transportDeclaresRule.meta,
    create(context) {
      const report = (descriptor) => {
        columns.push(descriptor.node.loc.start.column);
        context.report(descriptor);
      };

      return transportDeclaresRule.create(Object.create(context, { report: { value: report } }));
    },
  };
  const code = [...ROUTER_HEAD, ...routeLines, "  .build();"].join("\n");

  return runRule(probe, { code, cwd: workspace.cwd, filename: REST_ROUTES }).map(
    ({ data, line, messageId }, index) => [messageId, data.field, line, columns[index]],
  );
}

describe("given a route whose own chain declares a producer", () => {
  /** @scenario "A handler takes the producer its own route declared" */
  it("accepts response, request and raw from a protocol route that reads a raw body", () => {
    expect(
      located(
        '  .post("/widgets/grant", "grantWidget")',
        '  .withRawBody("text", { mediaType: "application/json" })',
        '  .withResponse("protocol", { produces: "application/json", because: "RFC" })',
        "  .handle(async ({ app, raw, request, response }) =>",
        "    answer(response, await app.grantWidget({ raw, request })),",
        "  )",
      ),
    ).toEqual([]);
  });

  it("accepts response from a bytes route, request from a forwarded one and files from a multipart one", () => {
    expect(
      located(
        '  .post("/widgets/export", "exportWidgets")',
        "  .withInput(exportSchema)",
        '  .withResponse("bytes", { produces: "text/csv" })',
        "  .handle(async ({ app, input, response }) => response.stream(await app.exportWidgets(input)))",
        '  .get("/widgets/proxy", "proxyWidgets")',
        '  .withResponse("forwarded", { because: "upstream owns the wire" })',
        "  .handle(async (context) => context.response.pass(await context.app.proxyWidgets(context.request)))",
        '  .post("/widgets/upload", "uploadWidget")',
        "  .withMultipart({ fields: uploadSchema, files: { sheet: { required: true } } })",
        "  .handle(async ({ app, input, files }) => app.uploadWidget({ input, sheet: files.sheet }))",
      ),
    ).toEqual([]);
  });
});

describe("given a handler taking a producer its route did not declare", () => {
  /** @scenario "A handler taking a producer its own route did not declare is reported at the field" */
  it("reports raw without withRawBody, request on a bytes route and files without withMultipart", () => {
    expect(
      located(
        '  .post("/widgets/grant", "grantWidget")',
        "  .withInput(grantSchema)",
        '  .withResponse("bytes", { produces: "text/csv" })',
        "  .handle(async ({ app, raw, request, files, response }) =>",
        "    response.stream(await app.grantWidget({ raw, request, files })),",
        "  )",
      ),
    ).toEqual([
      ["rawContextField", "raw", 6, 24],
      ["rawContextField", "request", 6, 29],
      ["rawContextField", "files", 6, 38],
    ]);
  });

  it("reports response and raw when only an earlier route in the same chain declared them", () => {
    expect(
      located(
        '  .post("/widgets/grant", "grantWidget")',
        '  .withRawBody("text")',
        '  .withResponse("protocol", { produces: "application/json", because: "RFC" })',
        "  .handle(async ({ app, raw, response }) => answer(response, await app.grantWidget(raw)))",
        '  .post("/widgets/revoke", "revokeWidget")',
        "  .withInput(revokeSchema)",
        "  .withOutput(revokeSchema)",
        "  .handle(async ({ app, input, raw, response }) => answer(response, await app.revokeWidget(input, raw)))",
      ),
    ).toEqual([
      ["rawContextField", "raw", 10, 31],
      ["rawContextField", "response", 10, 36],
    ]);
  });

  it("reports request when the declared kind is not written as a literal", () => {
    expect(
      located(
        '  .get("/widgets/proxy", "proxyWidgets")',
        '  .withResponse(FORWARDED, { because: "upstream owns the wire" })',
        "  .handle(async ({ app, request, response }) => response.pass(await app.proxyWidgets(request)))",
      ),
    ).toEqual([["rawContextField", "request", 5, 24]]);
  });

  it("reports the context's response member on a route that declared no producer", () => {
    expect(
      located(
        '  .get("/widgets", "listWidgets")',
        "  .withOutput(widgetsSchema)",
        "  .handle(async (context) => context.response.write(await context.app.listWidgets()))",
      ),
    ).toEqual([["rawContextAccess", undefined, 5, 29]]);
  });
});

describe("given fluent route handlers in a transport", () => {
  /** @scenario "A handler that shapes the response itself is refused" */
  it("reports response methods, raw responses, raw access, sentinels, detached handlers and mutations", () => {
    const code = [
      "declare const rest: { get(...args: unknown[]): void };",
      "const detached = async (context) => {",
      "  context.req;",
      "  return NO_CONTENT;",
      "};",
      'rest.get("/widgets", "2026-08-28", (endpoint) => endpoint.handle(detached));',
      'rest.get("/raw", "2026-08-28", (endpoint) => endpoint.handle(async (context) => {',
      "  context.status = 204;",
      "  return context.json({ ok: true });",
      "}));",
      'rest.get("/response", "2026-08-28", (endpoint) => endpoint.handle(() => new Response("ok")));',
    ].join("\n");

    expect(found(code)).toEqual([
      ["handlerNotInline", 6],
      ["rawContextAccess", 3],
      ["noContentSentinel", 4],
      ["responseMutation", 8],
      ["responseMethod", 9],
      ["rawResponse", 11],
    ]);
  });

  it("reports header reads and response-shaped calls but not a DTO's own status", () => {
    const code = [
      "declare const rest: { post(...args: unknown[]): void };",
      'rest.post("/widgets", "2026-08-28", (endpoint) => endpoint.withInput({}).handle(async ({ input, app }) => {',
      "  const data = input;",
      "  data.headers;",
      '  data.status = "draft";',
      "  await app.text({ value: 1 });",
      "  return NO_CONTENTS;",
      "}));",
    ].join("\n");

    expect(found(code)).toEqual([
      ["transportHeaders", 4],
      ["responseMethod", 6],
    ]);
  });

  it("reports legacy registerRoute handlers", () => {
    const code = [
      "declare const service: { registerRoute(...args: unknown[]): void };",
      "const handler = async (context: { req: Request }) => context.req;",
      'service.registerRoute("get", "/widgets", "2026-08-28", handler, () => undefined);',
    ].join("\n");

    expect(found(code)).toEqual([
      ["legacyRegisterRoute", 3],
      ["rawContextAccess", 2],
    ]);
  });

  it("reports computed raw access and a handler factory", () => {
    const code = [
      "declare const rest: { get(...args: unknown[]): void };",
      "const makeHandler = () => async (context: unknown) => context;",
      'rest.get("/raw", "2026-08-28", (endpoint) => endpoint.handle(async (context) => context["req"]));',
      'rest.get("/factory", "2026-08-28", (endpoint) => endpoint.handle(makeHandler()));',
    ].join("\n");

    expect(found(code)).toEqual([
      ["rawContextAccess", 3],
      ["handlerNotInline", 4],
    ]);
  });
});

describe("given a handler that does more than call one operation", () => {
  /** @scenario "A handler calls exactly one operation on app" */
  it("reports a second call, a branch and a call from a callback, each where it happens", () => {
    const code = [
      "declare const group: { register(...args: unknown[]): void };",
      "const toPublic = (value: unknown) => value;",
      'group.register("allowed", "2026-08-28", async (context, input) => {',
      "  await context.authorize(input.projectId);",
      "  return toPublic(await context.app.widgets.get(input));",
      "});",
      'group.register("many", "2026-08-28", async (context, input) => {',
      "  await context.app.widgets.get(input);",
      "  return context.app.widgets.update(input);",
      "});",
      'group.register("branch", "2026-08-28", async (context, input) => {',
      "  if (input.archived) return context.app.widgets.archive(input);",
      "  return context.app.widgets.get(input);",
      "});",
      'group.register("nested", "2026-08-28", async (context, input) => {',
      "  return Promise.all(input.ids.map((id) => context.app.widgets.get({ id })));",
      "});",
    ].join("\n");

    expect(found(code)).toEqual([
      ["multipleOperationCalls", 9],
      ["multipleOperationCalls", 13],
      ["handlerControlFlow", 12],
      ["nestedOperationCall", 16],
    ]);
  });

  it.each([
    [
      "directly",
      "context.app.widget.widgets.get(input); return context.app.widget.widgets.update(input);",
    ],
    [
      "through an alias",
      "const w = context.app.widget.widgets; w.get(input); return w.update(input);",
    ],
    [
      "through a destructured name",
      "const { widgets } = context.app.widget; widgets.get(input); return widgets.update(input);",
    ],
    [
      "through nested destructuring",
      "const { widget: { widgets } } = context.app; widgets.get(input); return widgets.update(input);",
    ],
  ])("counts calls made %s", (_how, body) => {
    const code = `group.register("many", "2026-08-28", async (context, input) => { ${body} });`;

    expect(report(code)).toEqual([
      expect.objectContaining({ messageId: "multipleOperationCalls", data: { count: 2 } }),
    ]);
  });

  it("reports a handler body longer than six statements at the body", () => {
    const statements = Array.from({ length: 7 }, (_, index) => `  const v${index} = ${index};`);
    const code = ['group.register("long", "2026-08-28", (context) => {', ...statements, "});"].join(
      "\n",
    );

    expect(report(code)).toEqual([
      expect.objectContaining({ messageId: "handlerTooLong", line: 1, data: { count: 7, max: 6 } }),
    ]);
  });
});

describe("given a handler that builds its own collaborators", () => {
  /** @scenario "A handler that constructs a service or repository is refused" */
  it.each(["new WidgetApp()", "WidgetApp.create()", "createWidgetApp()", "WidgetService.create()"])(
    "reports %s",
    (construction) => {
      const code = `group.register("create", "2026-08-28", async (context, input) => ${construction});`;

      expect(report(code)).toEqual([
        expect.objectContaining({ messageId: "handlerConstructs", line: 1 }),
      ]);
    },
  );

  it("follows a named handler and an import alias", () => {
    const code = [
      'import { WidgetRepository as Store } from "./widget";',
      "const named = () => new Store();",
      'group.register("get", "2026-08-28", named);',
    ].join("\n");

    expect(report(code)).toEqual([
      expect.objectContaining({
        messageId: "handlerConstructs",
        line: 2,
        data: { name: "WidgetRepository" },
      }),
    ]);
  });
});

describe("given a transport that talks to Hono, the context bag or a string dispatcher", () => {
  /** @scenario "A transport that bypasses the framework's typed boundary is refused" */
  it("reports raw Hono routes on a Hono-typed parameter", () => {
    const code = [
      'import type { Hono } from "hono";',
      "export function install(app: Hono) {",
      '  app.get("/widgets/:id", (context) => context.json({ id: "widget_1" }));',
      "}",
    ].join("\n");

    expect(found(code)).toContainEqual(["rawHonoRoute", 3]);
  });

  it("reports credentials read off the request context, and only those", () => {
    const code = [
      "declare const c: { get(key: string): unknown };",
      'const apiKeyId = c.get("apiKeyId");',
      'const project = c.get("project");',
    ].join("\n");

    expect(found(code)).toEqual([["credentialFromContext", 2]]);
  });

  it("reports generic string-path dispatch declarations and calls", () => {
    const code = [
      "abstract class RpcClient {",
      "  abstract query(path: string, input: unknown): Promise<unknown>;",
      "  abstract mutate(path: string, input: unknown): Promise<unknown>;",
      "}",
      "type AlternateRpc = {",
      "  query: (path: string, input: unknown) => Promise<unknown>;",
      "};",
      "declare const rpc: RpcClient;",
      'void rpc["query"]("widgets.get", { id: "widget_1" });',
    ].join("\n");

    expect(found(code)).toEqual([
      ["stringDispatch", 2],
      ["stringDispatch", 3],
      ["stringDispatch", 6],
      ["stringPathCall", 9],
    ]);
  });

  it("accepts a synchronous query-string reader", () => {
    const code = [
      "type RequestQuery = { query(name: string): string | undefined };",
      "declare const request: RequestQuery;",
      'void request.query("anchor");',
    ].join("\n");

    expect(report(code)).toEqual([]);
  });
});

describe("given files the rule does not read", () => {
  it.each([
    "modules/widget/process/src/transport/__tests__/widget.api.ts",
    "modules/widget/process/src/transport/widget.api.test.ts",
    "modules/widget/contract/src/widget.ts",
    "apps/api/src/main.ts",
  ])("reports nothing for %s", (filename) => {
    const code = 'group.register("create", "2026-08-28", async () => new WidgetService());';

    expect(report(code, filename)).toEqual([]);
  });
});
