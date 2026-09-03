/**
 * What the API snippets tell a customer to post to.
 *
 * `platform/app` read `window.location` inline, which is why nothing ever
 * asserted this: the two branches differ only on the hostname, and getting them
 * the wrong way round hands a self-hosted customer a snippet that talks to
 * app.langwatch.ai — their traffic, their keys, somebody else's installation.
 *
 * Spec: specs/evaluations/evaluation-pages.feature
 */

import { describe, expect, it } from "vitest";

import { langwatchEndpoint, langwatchEndpointEnv } from "../langwatch-endpoint";

const selfHosted = { protocol: "https:", hostname: "langwatch.acme.internal", port: "" };
const local = { protocol: "http:", hostname: "localhost", port: "5560" };
const hosted = { protocol: "https:", hostname: "app.langwatch.ai", port: "" };

describe("given a self-hosted installation", () => {
  describe("when the snippets are rendered", () => {
    /** @scenario "The API snippets name this installation's own endpoint" */
    it("points the SDK at this installation rather than the hosted service", () => {
      expect(langwatchEndpoint(selfHosted)).toBe("https://langwatch.acme.internal");
      expect(langwatchEndpointEnv(selfHosted)).toBe(
        "export LANGWATCH_ENDPOINT='https://langwatch.acme.internal'\n",
      );
    });

    /** @scenario "The API snippets name this installation's own endpoint" */
    it("carries a non-standard port and drops the standard ones", () => {
      expect(langwatchEndpoint(local)).toBe("http://localhost:5560");
      expect(langwatchEndpoint({ ...local, port: "443" })).toBe("http://localhost");
      expect(langwatchEndpoint({ ...local, port: "80" })).toBe("http://localhost");
    });
  });
});

describe("given the hosted service", () => {
  describe("when the snippets are rendered", () => {
    /** @scenario "The API snippets name this installation's own endpoint" */
    it("says nothing about the endpoint, because the SDK's default is right", () => {
      expect(langwatchEndpointEnv(hosted)).toBe("");
      expect(langwatchEndpoint(hosted)).toBe("https://app.langwatch.ai");
    });
  });
});

describe("given no document at all", () => {
  describe("when the snippets are rendered", () => {
    /** @scenario "The API snippets name this installation's own endpoint" */
    it("falls back to the hosted service rather than emitting a broken URL", () => {
      expect(langwatchEndpointEnv(null)).toBe("");
      expect(langwatchEndpoint(null)).toBe("https://app.langwatch.ai");
    });
  });
});
