// @vitest-environment node
import { RUM_SERVICE_NAME } from "@langwatch/react-rum/constants";
import { describe, expect, it } from "vitest";

import {
  countSpans,
  parseTraceExport,
  withPlatformIdentity,
  type BrowserTraceExport,
} from "../browser-trace-export.rules.ts";
import { collectorHeaders, collectorTracesUrl, rumCallerKey } from "../rum-ingest.rules.ts";

const attribute = (key: string, value: string) => ({ key, value: { stringValue: value } });

function attributesOf(traceExport: BrowserTraceExport, key: string) {
  return (traceExport.resourceSpans[0]?.resource?.attributes ?? []).filter(
    (candidate) => candidate.key === key,
  );
}

describe("a browser trace export", () => {
  describe("when it claims to be another service", () => {
    /** @scenario "A report claiming to be another service reaches the collector as the browser app" */
    it("carries exactly one service.name, the browser app's", () => {
      const stamped = withPlatformIdentity({
        resourceSpans: [
          {
            resource: {
              attributes: [
                attribute("service.name", RUM_SERVICE_NAME),
                attribute("service.name", "langwatch-app"),
              ],
            },
          },
        ],
      });

      const names = attributesOf(stamped, "service.name");
      expect(names).toEqual([attribute("service.name", RUM_SERVICE_NAME)]);
    });
  });

  describe("when it sets its own origin marker", () => {
    /** @scenario "A report cannot set its own origin marker" */
    it("replaces the marker with platform_internal", () => {
      const stamped = withPlatformIdentity({
        resourceSpans: [
          { resource: { attributes: [attribute("langwatch.origin", "customer_data")] } },
        ],
      });

      expect(attributesOf(stamped, "langwatch.origin")).toEqual([
        attribute("langwatch.origin", "platform_internal"),
      ]);
    });

    it("keeps every attribute it does not own", () => {
      const stamped = withPlatformIdentity({
        resourceSpans: [{ resource: { attributes: [attribute("session.id", "abc")] } }],
      });

      expect(attributesOf(stamped, "session.id")).toEqual([attribute("session.id", "abc")]);
    });
  });

  describe("when it is spread across resources and scopes", () => {
    it("counts every span in it", () => {
      expect(
        countSpans([
          { scopeSpans: [{ spans: [{}, {}] }, { spans: [{}] }] },
          { scopeSpans: [{ spans: [{}] }] },
          { scopeSpans: [{}] },
        ]),
      ).toBe(4);
    });
  });

  describe("when a field the door walks has the wrong shape", () => {
    it.each([
      ["not json at all", "<html>"],
      ["a body of bare null", "null"],
      ["json with no resourceSpans", "{}"],
      ["an empty resourceSpans list", '{"resourceSpans":[]}'],
      ["a resource span that is not an object", '{"resourceSpans":[null]}'],
      [
        "attributes that are not a list",
        '{"resourceSpans":[{"resource":{"attributes":"service.name"},"scopeSpans":[{"spans":[{}]}]}]}',
      ],
      [
        "an attribute that is not an object",
        '{"resourceSpans":[{"resource":{"attributes":[null]},"scopeSpans":[{"spans":[{}]}]}]}',
      ],
      ["scopeSpans that are not a list", '{"resourceSpans":[{"scopeSpans":{"spans":[{}]}}]}'],
      ["spans that are not a list", '{"resourceSpans":[{"scopeSpans":[{"spans":7}]}]}'],
    ])("reads %s as unwalkable", (_case, body) => {
      expect(parseTraceExport(body).walkable).toBe(false);
    });

    it("passes every field it does not walk through untouched", () => {
      const parsed = parseTraceExport(
        '{"resourceSpans":[{"schemaUrl":"s","scopeSpans":[{"scope":{"name":"x"},"spans":[{"name":"a"}]}]}],"extra":1}',
      );

      expect(parsed).toEqual({
        walkable: true,
        traceExport: {
          resourceSpans: [
            { schemaUrl: "s", scopeSpans: [{ scope: { name: "x" }, spans: [{ name: "a" }] }] },
          ],
          extra: 1,
        },
      });
    });
  });
});

describe("the door's caller key", () => {
  it("names a caller by its claimed session, capped at 64 characters", () => {
    expect(rumCallerKey({ session: "s".repeat(80), forwardedFor: "1.1.1.1" })).toBe(
      `session:${"s".repeat(64)}`,
    );
  });

  /** @scenario "A caller with no session is named by the nearest proxy's address" */
  it("names a caller with no session by the last forwarded-for hop", () => {
    expect(rumCallerKey({ session: undefined, forwardedFor: "6.6.6.6, 10.0.0.1 , 10.0.0.2" })).toBe(
      "ip:10.0.0.2",
    );
    expect(rumCallerKey({ session: undefined, forwardedFor: undefined })).toBe("ip:unknown");
  });
});

describe("the collector's address and headers", () => {
  it("appends the traces path to the endpoint without doubling a slash", () => {
    expect(collectorTracesUrl("http://collector.test:4318/")).toBe(
      "http://collector.test:4318/v1/traces",
    );
  });

  it("reads the OTLP header encoding, lower-casing names over a JSON content type", () => {
    expect(collectorHeaders("Authorization=Bearer abc123,x-scope=team,broken,=x")).toEqual({
      "content-type": "application/json",
      authorization: "Bearer abc123",
      "x-scope": "team",
    });
  });
});
