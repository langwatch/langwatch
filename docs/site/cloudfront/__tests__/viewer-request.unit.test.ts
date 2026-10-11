import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { readRedirects, resolveRedirect } from "../../docs-routing.mjs";
import { generateCloudFrontFunction } from "../generate.mjs";

const requestSchema = z.object({ uri: z.string(), querystring: z.record(z.string(), z.unknown()) });
const responseSchema = z.object({
  statusCode: z.number(),
  headers: z.object({ location: z.object({ value: z.string() }) }).optional(),
});

function invoke({
  uri,
  redirects = {},
  querystring = {},
}: {
  uri: string;
  redirects?: Record<string, string>;
  querystring?: Record<string, { value: string; multiValue?: { value: string }[] }>;
}) {
  const code = generateCloudFrontFunction({ redirects });
  return runInNewContext(`${code}\nhandler(event)`, {
    event: { request: { uri, querystring } },
  });
}

describe("when CloudFront receives a documentation request", () => {
  /** @scenario "Route directory URLs and preserve static assets" */
  it("rewrites pages and leaves files and query strings intact", () => {
    for (const [uri, expected] of [
      ["/", "/index.html"],
      ["/guide", "/guide/index.html"],
      ["/guide/", "/guide/index.html"],
      ["/assets/app-hash.js", "/assets/app-hash.js"],
      ["/images/logo.svg", "/images/logo.svg"],
      ["/guide.md", "/guide.md"],
      ["/404.html", "/404.html"],
      ["/search-index.json", "/search-index.json"],
      ["/constructor", "/constructor/index.html"],
    ]) {
      const querystring = { q: { value: "hello%20world" } };
      expect(requestSchema.parse(invoke({ uri, querystring }))).toEqual({
        uri: expected,
        querystring,
      });
    }
  });

  /** @scenario "Serve every configured redirect at the edge" */
  it("matches preview for every authored redirect, queries and trailing slashes", () => {
    const docsRoot = fileURLToPath(new URL("../../../", import.meta.url));
    const redirects = readRedirects({ docsRoot });
    expect(Object.keys(redirects)).toHaveLength(116);
    for (const source of Object.keys(redirects)) {
      for (const uri of [source, `${source}/`]) {
        const result = responseSchema.parse(
          invoke({
            uri,
            redirects,
            querystring: { from: { value: "search" } },
          }),
        );
        expect(result.statusCode).toBe(301);
        expect(result.headers?.location.value).toBe(
          resolveRedirect({ pathname: uri, search: "?from=search", redirects }),
        );
      }
    }
    const destination = "https://example.com/help?view=new#install";
    const result = responseSchema.parse(
      invoke({
        uri: "/old",
        redirects: { "/old": destination },
        querystring: {
          view: { value: "old" },
          q: {
            value: "hello%20world",
            multiValue: [{ value: "hello%20world" }, { value: "again" }],
          },
        },
      }),
    );
    expect(result.headers?.location.value).toBe(
      "https://example.com/help?view=new&q=hello%20world#install",
    );
  });

  /** @scenario "Reject malformed edge paths" */
  it("returns 400 for invalid URL encoding", () => {
    expect(responseSchema.parse(invoke({ uri: "/bad%ZZ" })).statusCode).toBe(400);
  });

  /** @scenario "Reject a function larger than the CloudFront limit" */
  it("refuses oversized redirect data", () => {
    expect(() =>
      generateCloudFrontFunction({ redirects: { "/old": "/" + "x".repeat(10_240) } }),
    ).toThrow("CloudFront function exceeds 10 KB");
  });
});
