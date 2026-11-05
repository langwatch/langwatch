import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { checkExternalLinks, externalLinks } from "../checks/external-links.ts";
import { buildFixture, page } from "./build-fixture.ts";

function requestUrl({ input }: { input: Parameters<typeof fetch>[0] }) {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

describe("when external links are checked on request", () => {
  const fixture = buildFixture({
    files: {
      "guide/index.html": page({
        slug: "guide",
        body: '<a href="https://ok.example/a#x">a</a><a href="https://bad.example/">b</a><a href="https://head.example/">c</a><a href="https://langwatch.ai/docs/guide">docs</a><a href="/local">l</a>',
      }),
      "index.html": page({ slug: "introduction", body: '<a href="https://ok.example/a">a</a>' }),
    },
  });
  const cacheDirectory = mkdtempSync(path.join(os.tmpdir(), "docs-external-"));
  afterAll(() => {
    fixture.dispose();
    rmSync(cacheDirectory, { recursive: true, force: true });
  });

  /** @scenario "External links are reported without failing the check" */
  it("requests each address once, remembers answers on disk and reports failures", async () => {
    const links = externalLinks({ index: fixture.index() });
    expect([...links.keys()]).toEqual([
      "https://ok.example/a",
      "https://bad.example/",
      "https://head.example/",
    ]);
    expect([...(links.get("https://ok.example/a") ?? [])]).toEqual([
      "/guide/index.html",
      "/index.html",
    ]);
    const requests: string[] = [];
    let active = 0;
    let peak = 0;
    const fetcher: typeof fetch = async (input, init) => {
      const href = requestUrl({ input });
      requests.push(`${init?.method} ${href}`);
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (href.startsWith("https://bad")) return new Response(null, { status: 404 });
      if (href.startsWith("https://head") && init?.method === "HEAD")
        return new Response(null, { status: 405 });
      return new Response(null, { status: 200 });
    };
    const cacheFile = path.join(cacheDirectory, "external.json");
    const first = await checkExternalLinks({
      links,
      cacheFile,
      concurrency: 2,
      fetcher,
      now: 1000,
    });
    expect(peak).toBeLessThanOrEqual(2);
    expect(requests.toSorted()).toEqual([
      "GET https://head.example/",
      "HEAD https://bad.example/",
      "HEAD https://head.example/",
      "HEAD https://ok.example/a",
    ]);
    expect(first.failures).toEqual([
      { href: "https://bad.example/", status: 404, sources: ["/guide/index.html"] },
    ]);
    expect(Object.keys(JSON.parse(readFileSync(cacheFile, "utf8")))).toHaveLength(3);

    requests.length = 0;
    const second = await checkExternalLinks({ links, cacheFile, fetcher, now: 2000 });
    expect(requests).toEqual(["HEAD https://bad.example/"]);
    expect(second.checked).toBe(3);
  });
});
