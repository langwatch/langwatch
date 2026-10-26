import { afterAll, describe, expect, it } from "vitest";

import { noTransportInServiceRule } from "../../src/rules/no-transport-in-service.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {} } } },
});

afterAll(() => workspace.cleanup());

const SERVICE = "modules/agent/process/src/services/agent.service.ts";
const TRANSPORT = "modules/agent/process/src/transport/agent.rest.ts";
const TEST = "modules/agent/process/src/services/__tests__/agent.service.unit.test.ts";

function report(code, filename = SERVICE) {
  return runRule(noTransportInServiceRule, { code, cwd: workspace.cwd, filename }).map(
    ({ data, line, messageId }) => ({ data, line, messageId }),
  );
}

describe("given a service", () => {
  describe("when it imports the HTTP module or a raw exchange type", () => {
    /** @scenario "A service may not name the HTTP wire" */
    it("reports transportInService once per import", () => {
      const code = [
        'import type { IncomingMessage, ServerResponse } from "node:http";',
        'import https from "https";',
        'import { ServerResponse as Res } from "./wire.ts";',
      ].join("\n");

      expect(report(code)).toEqual([
        { data: { name: "node:http" }, line: 1, messageId: "transportInService" },
        { data: { name: "https" }, line: 2, messageId: "transportInService" },
        { data: { name: "ServerResponse" }, line: 3, messageId: "transportInService" },
      ]);
    });

    /** @scenario "The report says how the service answers instead" */
    it("asks for plain values in the fix", () => {
      const [finding] = runRule(noTransportInServiceRule, {
        code: 'import type { IncomingMessage } from "node:http";',
        cwd: workspace.cwd,
        filename: SERVICE,
      });

      expect(finding.message).toContain("Take plain values");
    });
  });

  describe("when it writes the response head", () => {
    /** @scenario "A service may not write the response" */
    it("reports writesTheResponse", () => {
      const code = "export function send(res) {\n  res.writeHead(200, {});\n}";

      expect(report(code)).toEqual([
        { data: { shape: ".writeHead(" }, line: 2, messageId: "writesTheResponse" },
      ]);
    });
  });

  describe("when it builds a Fetch Response", () => {
    /** @scenario "A service may not build a Fetch Response" */
    it("reports buildsTheResponse for the constructor and each static factory", () => {
      const code = [
        "export const a = () => new Response(null, { status: 204 });",
        'export const b = () => Response.json({ error: "x" }, { status: 400 });',
        'export const c = () => Response.redirect("https://example.com", 302);',
        "export const d = () => Response.error();",
      ].join("\n");

      expect(report(code)).toEqual([
        { data: { shape: "new Response(" }, line: 1, messageId: "buildsTheResponse" },
        { data: { shape: "Response.json(" }, line: 2, messageId: "buildsTheResponse" },
        { data: { shape: "Response.redirect(" }, line: 3, messageId: "buildsTheResponse" },
        { data: { shape: "Response.error(" }, line: 4, messageId: "buildsTheResponse" },
      ]);
    });

    /** @scenario "A Response the service imports under that name is not the Fetch one" */
    it("reports nothing when Response is the file's own import", () => {
      const code = [
        'import { Response } from "./answer.ts";',
        "export const a = () => new Response();",
        "export const b = () => Response.json({});",
      ].join("\n");

      expect(report(code)).toEqual([]);
    });
  });

  describe("when it writes status, headers or body on a response", () => {
    /** @scenario "A service may not set the status, headers or body of a response" */
    it("reports writesTheResponse for each write on a response-named receiver", () => {
      const code = [
        "export function send(res, ctx) {",
        "  res.statusCode = 404;",
        '  res.setHeader("content-type", "text/plain");',
        '  ctx.response.write("a");',
        "  res.end();",
        "}",
      ].join("\n");

      expect(report(code)).toEqual([
        { data: { shape: ".statusCode =" }, line: 2, messageId: "writesTheResponse" },
        { data: { shape: ".setHeader(" }, line: 3, messageId: "writesTheResponse" },
        { data: { shape: ".write(" }, line: 4, messageId: "writesTheResponse" },
        { data: { shape: ".end(" }, line: 5, messageId: "writesTheResponse" },
      ]);
    });

    /** @scenario "A service may not set the status, headers or body of a response" */
    it("reports a write on a binding typed as a response, whatever its name", () => {
      const code = [
        'import type { OutgoingMessage } from "./wire.ts";',
        "export function send(out: OutgoingMessage) {",
        '  out.end("done");',
        "}",
      ].join("\n");

      expect(report(code)).toEqual([
        { data: { shape: ".end(" }, line: 3, messageId: "writesTheResponse" },
      ]);
    });

    /** @scenario "A stream or an error with the same method names is not a response" */
    it("reports nothing for a stream, a socket or an error", () => {
      const code = [
        "export function close(stream, socket, error: Error & { statusCode?: number }) {",
        '  stream.write("a");',
        "  stream.end();",
        "  socket.end();",
        "  error.statusCode = 500;",
        '  headers.set("location", "/");',
        "}",
      ].join("\n");

      expect(report(code)).toEqual([]);
    });
  });

  describe("when the code is not a service", () => {
    /** @scenario "A transport and a test may name the wire" */
    it("reports nothing", () => {
      const code = [
        'import type { IncomingMessage } from "node:http";',
        "res.writeHead(200);",
        "res.statusCode = 200;",
        "export const a = () => Response.json({ ok: true });",
      ].join("\n");

      expect(report(code, TRANSPORT)).toEqual([]);
      expect(report(code, TEST)).toEqual([]);
    });
  });
});
