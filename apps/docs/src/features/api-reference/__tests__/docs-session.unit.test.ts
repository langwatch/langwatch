import { describe, expect, it } from "vitest";

import { readBuildOptions } from "../../../paths.ts";
import { connectedRequest, readConsentAnswer, resolveAppOrigin } from "../model/docs-session.ts";
import { operationSchema } from "../model/operation-schema.ts";

const APP = "https://app.example.test";
const STATE = "s".repeat(43);
const operation = operationSchema.parse({
  method: "POST",
  path: "/api/traces/search",
  origin: "https://app.langwatch.ai",
  summary: "Search traces",
  description: "",
  deprecated: false,
  schemes: [{ id: "bearer", type: "http", scheme: "bearer" }],
  parameters: [],
  body: { required: false, description: "", contents: [] },
  responses: [],
});
const grant = {
  type: "langwatch:docs-session",
  version: 1,
  state: STATE,
  outcome: "granted",
  token: "sk-lw-docs-session-0123456789",
  expiresAt: "2026-10-26T12:05:00.000Z",
  project: { id: "project_1", name: "Checkout agent" },
};

describe("when the consent page answers", () => {
  /** @scenario "Ignore any message that is not the expected answer" */
  it("accepts only a well-formed answer for this state", () => {
    expect(readConsentAnswer({ data: grant, state: STATE, appOrigin: APP })).toEqual({
      outcome: "granted",
      session: {
        token: grant.token,
        expiresAt: Date.parse(grant.expiresAt),
        project: grant.project,
        appOrigin: APP,
      },
    });
    for (const data of [
      { ...grant, state: "t".repeat(43) },
      { ...grant, version: 2 },
      { ...grant, type: "other" },
      { ...grant, token: "" },
      { ...grant, expiresAt: "soon" },
      { ...grant, project: { id: "" } },
      null,
      "granted",
    ])
      expect(readConsentAnswer({ data, state: STATE, appOrigin: APP })).toBeNull();
  });

  /** @scenario "Fall back to a pasted key when connecting does not work" */
  it("reads a denial for this state", () => {
    const denial = { type: grant.type, version: 1, state: STATE, outcome: "denied" };
    expect(readConsentAnswer({ data: denial, state: STATE, appOrigin: APP })).toEqual({
      outcome: "denied",
    });
  });
});

describe("when the playground sends as the connected member", () => {
  /** @scenario "Connect with my account" */
  it("calls the app's API with the key as X-Auth-Token, whatever the documented scheme", () => {
    const request = connectedRequest({
      operation,
      state: { values: {}, body: '{"query":"refund"}' },
      session: {
        token: grant.token,
        expiresAt: 0,
        project: grant.project,
        appOrigin: APP,
      },
    });
    expect(request.url).toBe(`${APP}/api/traces/search`);
    expect(request.headers["X-Auth-Token"]).toBe(grant.token);
    expect(Object.keys(request.headers)).not.toContain("Authorization");
    expect(request.body).toBe('{"query":"refund"}');
  });
});

describe("when the build names the app", () => {
  /** @scenario "Offer only the pasted key when the build names no app" */
  it("resolves self to the page's origin and reads the build option", () => {
    expect(resolveAppOrigin({ configured: "self", pageOrigin: APP })).toBe(APP);
    expect(resolveAppOrigin({ configured: "", pageOrigin: APP })).toBe("");
    expect(readBuildOptions({ args: [] }).appOrigin).toBe("https://app.langwatch.ai");
    expect(readBuildOptions({ args: ["--app-origin", "self"] }).appOrigin).toBe("self");
    expect(
      readBuildOptions({ args: ["--app-origin", "https://lw.example.test/x"] }).appOrigin,
    ).toBe("https://lw.example.test");
    expect(() => readBuildOptions({ args: ["--app-origin", "app.example.test"] })).toThrow(
      /an app origin is self, none or an http\(s\) URL/,
    );
  });
});
