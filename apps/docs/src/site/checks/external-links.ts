import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { nowInstant } from "@langwatch/time";
import { z } from "zod";

import type { BuildIndex } from "./build-index.ts";
import { isDocsAddress } from "./resolve.ts";

const cacheSchema = z.record(z.string(), z.object({ status: z.number(), checkedAt: z.number() }));
type ExternalCache = z.infer<typeof cacheSchema>;
export type ExternalResult = { href: string; status: number; sources: string[] };

const DAY = 24 * 60 * 60 * 1000;

/** External http(s) links in the build's HTML, each with the pages that use it. */
export function externalLinks({ index }: { index: BuildIndex }) {
  const sources = new Map<string, Set<string>>();
  for (const [file, facts] of index.html) {
    const source = `/${path.relative(index.outDir, file).split(path.sep).join("/")}`;
    for (const href of facts.hrefs) {
      if (!/^https?:\/\//.test(href) || isDocsAddress({ href })) continue;
      const url = href.split("#")[0] ?? href;
      sources.set(url, (sources.get(url) ?? new Set()).add(source));
    }
  }
  return sources;
}

function readCache({ file }: { file: string }): ExternalCache {
  if (!existsSync(file)) return {};
  const parsed = cacheSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
  return parsed.success ? parsed.data : {};
}

/** HEAD first, GET when a server refuses HEAD; 0 is a network failure or timeout. */
async function requestStatus({ href, fetcher }: { href: string; fetcher: typeof fetch }) {
  for (const method of ["HEAD", "GET"]) {
    try {
      const response = await fetcher(href, {
        method,
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
      });
      await response.body?.cancel();
      if (method === "HEAD" && [403, 405, 501].includes(response.status)) continue;
      return response.status;
    } catch {
      if (method === "GET") return 0;
    }
  }
  return 0;
}

/**
 * Requests each external link once, `concurrency` at a time; answers younger than `maxAge` are
 * reused.
 */
export async function checkExternalLinks({
  links,
  cacheFile,
  concurrency = 8,
  maxAge = DAY,
  fetcher = fetch,
  now = nowInstant().epochMilliseconds,
}: {
  links: Map<string, Set<string>>;
  cacheFile: string;
  concurrency?: number;
  maxAge?: number;
  fetcher?: typeof fetch;
  now?: number;
}) {
  const cache = readCache({ file: cacheFile });
  const queue = [...links.keys()];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    for (let href = queue.shift(); href !== undefined; href = queue.shift()) {
      const cached = cache[href];
      if (cached && now - cached.checkedAt < maxAge && cached.status < 400 && cached.status > 0)
        continue;
      cache[href] = { status: await requestStatus({ href, fetcher }), checkedAt: now };
    }
  });
  await Promise.all(workers);
  mkdirSync(path.dirname(cacheFile), { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(cache));
  const failures: ExternalResult[] = [...links]
    .map(([href, sources]) => ({ href, status: cache[href]?.status ?? 0, sources: [...sources] }))
    .filter((result) => result.status === 0 || result.status >= 400);
  return { checked: links.size, failures };
}
