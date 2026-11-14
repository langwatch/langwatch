import { describe, expect, it } from "vitest";

import { publishSearchIndex } from "../compile/search-index.ts";
import { decodeSearchIndex, searchIndex } from "../model/search-engine.ts";

/* Representative pages: a guide, an SDK reference, an API operation, a self-hosting page. */
const pages = [
  {
    slug: "integration/python/guide",
    title: "Python Integration Guide",
    section: "Integrations",
    description: "Capture traces from Python",
    trail: "Integrations › Python",
    body: "Install the SDK with pip install langwatch. Set LANGWATCH_API_KEY before you call langwatch.setup(). Spans nest under the active trace.",
    headings: [
      { id: "installation", text: "Installation" },
      { id: "capturing-spans", text: "Capturing spans" },
    ],
  },
  {
    slug: "integration/typescript/reference",
    title: "TypeScript SDK reference",
    section: "Integrations",
    description: "Every exported function",
    trail: "Integrations › TypeScript",
    body: "getLangWatchTracer returns a tracer. Use withActiveSpan for async work. The exporter batches spans every 5000 ms.",
    headings: [{ id: "getlangwatchtracer", text: "getLangWatchTracer" }],
  },
  {
    slug: "api-reference/traces/search",
    method: "POST",
    title: "Search traces",
    section: "API reference",
    description: "Query recorded traces",
    trail: "API reference › Traces",
    body: "POST /api/traces/search pageSize integer The page size. scrollId string Cursor for the next page. filters object",
    headings: [],
  },
  {
    slug: "self-hosting/configuration/environment-variables",
    title: "Environment variables",
    section: "Self-hosting",
    description: "Configure a self-hosted deployment",
    trail: "Self-hosting › Configuration",
    body: "CLICKHOUSE_URL points at ClickHouse. REDIS_URL is required for workers. Set NEXTAUTH_SECRET to a random value.",
    headings: [{ id: "clickhouse", text: "ClickHouse" }],
  },
];
const index = decodeSearchIndex({ data: JSON.parse(publishSearchIndex({ entries: pages })) });

function search({ query }: { query: string }) {
  return searchIndex({ index, query }).map((result) => ({
    slug: result.entry.slug,
    heading: result.heading?.id,
  }));
}
const slugs = ({ query }: { query: string }) => search({ query }).map((result) => result.slug);

describe("when a reader searches representative queries", () => {
  /** @scenario "Find the same pages from the compact index" */
  it("finds pages by title, heading, body word, body prefix, API text and near miss", () => {
    expect(slugs({ query: "environment variables" })).toEqual([
      "self-hosting/configuration/environment-variables",
    ]);
    expect(search({ query: "capturing" })).toEqual([
      { slug: "integration/python/guide", heading: "capturing-spans" },
    ]);
    expect(slugs({ query: "withActiveSpan" })).toEqual(["integration/typescript/reference"]);
    expect(slugs({ query: "withact" })).toEqual(["integration/typescript/reference"]);
    expect(slugs({ query: "langwatch.setup" })).toEqual(["integration/python/guide"]);
    expect(slugs({ query: "NEXTAUTH_SECRET" })).toEqual([
      "self-hosting/configuration/environment-variables",
    ]);
    expect(slugs({ query: "scrollid" })).toEqual(["api-reference/traces/search"]);
    expect(slugs({ query: "/api/traces/search" })).toEqual(["api-reference/traces/search"]);
    expect(slugs({ query: "5000" })).toEqual(["integration/typescript/reference"]);
    expect(slugs({ query: "clikhouse" })).toEqual([]);
    expect(slugs({ query: "enviroment" })).toEqual([
      "self-hosting/configuration/environment-variables",
    ]);
  });

  /** @scenario "Find the same pages from the compact index" */
  it("ranks title matches above body matches and needs every term", () => {
    expect(slugs({ query: "spans" })).toEqual([
      "integration/python/guide",
      "integration/typescript/reference",
    ]);
    expect(slugs({ query: "traces" })[0]).toBe("api-reference/traces/search");
    expect(slugs({ query: "spans redis" })).toEqual([]);
    expect(slugs({ query: "how do i search traces" })).toEqual(["api-reference/traces/search"]);
  });

  /** @scenario "Find the same pages from the compact index" */
  it("ignores punctuation around a term but matches the punctuation inside it", () => {
    expect(slugs({ query: '"scrollId":' })).toEqual(["api-reference/traces/search"]);
    expect(slugs({ query: "traces/search" })).toEqual(["api-reference/traces/search"]);
    expect(slugs({ query: "langwatch.setup()" })).toEqual(["integration/python/guide"]);
    expect(slugs({ query: "pagesize.integer" })).toEqual([]);
    expect(slugs({ query: "setup.langwatch" })).toEqual([]);
  });
});
