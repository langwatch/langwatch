import { describe, expect, it } from "vitest";

import { readBuildOptions } from "../../../paths.ts";
import {
  appFramesPage,
  frameRequest,
  frameUrl,
  readFrameMessage,
  resolveAppOrigin,
  sessionCovers,
} from "../model/docs-session.ts";
import { operationSchema } from "../model/operation-schema.ts";

const APP = "https://app.example.test";
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
describe("when the frame speaks", () => {
  /** @scenario "Listen only to the frame it embedded" */
  it("reads only the frame's own messages", () => {
    const state = {
      type: "langwatch:docs-frame",
      version: 1,
      kind: "state",
      connected: true,
      project: "Checkout",
    };
    expect(readFrameMessage({ data: state })).toEqual(state);
    for (const data of [
      { ...state, version: 2 },
      { ...state, type: "langwatch:docs-session" },
      { ...state, connected: "yes" },
      { ...state, kind: "token", token: "sk-lw" },
      { type: "langwatch:docs-frame", version: 1, kind: "failed", id: "r1", reason: "whatever" },
      null,
      "state",
    ])
      expect(readFrameMessage({ data })).toBeNull();
  });
});

describe("when the playground asks the frame to send", () => {
  /** @scenario "Send through the frame while it is connected" */
  it("names the path on the app's origin and no credential, whatever the documented scheme", () => {
    const request = frameRequest({ operation, state: { values: {}, body: '{"query":"refund"}' } });
    expect(request).toEqual({
      method: "POST",
      path: "/api/traces/search",
      headers: { "Content-Type": "application/json" },
      body: '{"query":"refund"}',
    });
  });

  /** @scenario "Embed the app's session frame where a project key answers" */
  it("embeds the frame for this docs origin", () => {
    expect(frameUrl({ appOrigin: APP, docsOrigin: "https://langwatch.ai" })).toBe(
      `${APP}/connect/docs/frame?origin=https%3A%2F%2Flangwatch.ai`,
    );
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

describe("where the app frames its session document", () => {
  /** @scenario "Offer only the pasted key where the app would refuse to be framed" */
  it("asks only from the published docs or the app's own origin", () => {
    expect(appFramesPage({ appOrigin: APP, pageOrigin: "https://langwatch.ai" })).toBe(true);
    expect(appFramesPage({ appOrigin: APP, pageOrigin: APP })).toBe(true);
    for (const pageOrigin of [
      "https://docs-origin.langwatch.ai",
      "https://docs.langwatch.ai",
      "http://localhost:5173",
      "https://langwatch.ai.evil.example",
    ])
      expect(appFramesPage({ appOrigin: APP, pageOrigin })).toBe(false);
    expect(appFramesPage({ appOrigin: "", pageOrigin: "https://langwatch.ai" })).toBe(false);
  });
});

describe("which endpoints a docs session can answer", () => {
  /** @scenario "Offer the connection only where a project key answers" */
  it("answers X-Auth-Token endpoints only, never a bearer or another header", () => {
    expect(
      sessionCovers({ scheme: { id: "k", type: "apiKey", in: "header", name: "X-Auth-Token" } }),
    ).toBe(true);
    expect(sessionCovers({ scheme: { id: "admin", type: "http", scheme: "bearer" } })).toBe(false);
    expect(
      sessionCovers({ scheme: { id: "k", type: "apiKey", in: "header", name: "X-Other" } }),
    ).toBe(false);
    expect(sessionCovers({ scheme: undefined })).toBe(false);
  });
});
