import { afterAll, describe, expect, it } from "vitest";

import { rawBodyBypassRule } from "../../src/rules/raw-body-bypass.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { process: {} } } },
});

afterAll(() => workspace.cleanup());

const TRANSPORT = "modules/agent/process/src/transport/agent.rest.ts";

function report(code, filename = TRANSPORT) {
  return runRule(rawBodyBypassRule, { code, cwd: workspace.cwd, filename });
}

function messageIds(code) {
  return report(code).map((finding) => finding.messageId);
}

describe("given a module transport", () => {
  describe("when withRawBody gives no because", () => {
    /** @scenario "A raw body without a because is reported" */
    it("reports rawBodyBecause, a blank one included", () => {
      expect(
        messageIds('route.withRawBody("bytes", { mediaType: "application/x-protobuf" });'),
      ).toEqual(["rawBodyBecause"]);
      expect(
        messageIds(
          'route.withRawBody("bytes", { mediaType: "application/x-protobuf", because: " " });',
        ),
      ).toEqual(["rawBodyBecause"]);
    });
  });

  describe("when withRawBody names no non-JSON media type", () => {
    /** @scenario "A raw body without a non-JSON media type is reported" */
    it("reports rawBodyMediaType for an absent, a JSON literal or a JSON constant media type", () => {
      expect(messageIds('route.withRawBody("text", { because: "signature" });')).toEqual([
        "rawBodyMediaType",
      ]);
      expect(
        messageIds(
          'route.withRawBody("text", { mediaType: "application/json", because: "legacy" });',
        ),
      ).toEqual(["rawBodyMediaType"]);
      expect(
        messageIds('route.withRawBody("text", { mediaType: PRODUCES_JSON, because: "legacy" });'),
      ).toEqual(["rawBodyMediaType"]);
      expect(messageIds('route.withRawBody("text");')).toEqual([
        "rawBodyMediaType",
        "rawBodyBecause",
      ]);
    });
  });

  describe("when withRawBody names a non-JSON media type and a because", () => {
    /** @scenario "A raw body with a because is accepted" */
    it("reports nothing", () => {
      expect(
        report(
          'route.withRawBody("bytes", { mediaType: "application/x-protobuf", because: "signature over exact bytes" });',
        ),
      ).toEqual([]);
      expect(
        report('route.withRawBody("text", { mediaType: PRODUCES_TEXT, because: SIGNED_REASON });'),
      ).toEqual([]);
    });
  });

  describe("when the handler parses JSON by hand", () => {
    /** @scenario "JSON.parse in a transport is reported" */
    it("reports jsonParse", () => {
      expect(messageIds("const body = JSON.parse(raw);")).toEqual(["jsonParse"]);
    });
  });
});

describe("given a module service", () => {
  describe("when it parses JSON", () => {
    /** @scenario "JSON.parse outside a transport is not this rule's business" */
    it("reports nothing", () => {
      expect(
        report(
          "const value = JSON.parse(text);",
          "modules/agent/process/src/services/agent.service.ts",
        ),
      ).toEqual([]);
    });
  });
});
