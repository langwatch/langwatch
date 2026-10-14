/**
 * Fails the build when the entry, or a chunk every board page loads, imports the 600 kB shiki
 * chunk statically: a page downloads that chunk whether or not it ever shows code. Code
 * highlighting must reach Shiki through `import()` (see the design system's `shiki-adapter`).
 */

import type { Plugin } from "vite";

/** The manual chunk the Shiki engine lands in (see the design system's `shiki-chunking`). */
const SHIKI_CHUNK = "shiki";

/** The modules a board page loads besides the entry: its layouts and the dashboards screens. */
export const BOARD_PAGE_ROOTS: readonly RegExp[] = [
  /[\\/]features[\\/]dashboards[\\/]ui[\\/]sections[\\/](dashboards-index|curated-board|dashboard-board)\.screen\.tsx$/,
  /[\\/]project-langy-layout\.tsx$/,
  /[\\/]trace-drawer-layout\.tsx$/,
  /[\\/]global-trace-v2-drawer-mount\.tsx$/,
];

/** The part of a Rollup output chunk the guard reads. */
export interface GuardedChunk {
  readonly name: string;
  readonly isEntry: boolean;
  readonly facadeModuleId: string | null;
  /** File names of the chunks it imports statically. */
  readonly imports: readonly string[];
}

/**
 * For each root that reaches the shiki chunk through static imports, the chain of chunk names
 * from the root to it. Empty when no root does.
 */
export function shikiReachViolations({
  chunks,
  roots = BOARD_PAGE_ROOTS,
}: {
  chunks: Readonly<Record<string, GuardedChunk>>;
  roots?: readonly RegExp[];
}): string[][] {
  const isRoot = (chunk: GuardedChunk) =>
    chunk.isEntry || roots.some((root) => root.test(chunk.facadeModuleId ?? ""));
  return Object.keys(chunks)
    .filter((file) => isRoot(chunks[file]!))
    .flatMap((file) => {
      const chain = staticChainToShiki({ chunks, from: file });
      return chain ? [chain] : [];
    });
}

/** Breadth-first, so the reported chain is a shortest one. */
function staticChainToShiki({
  chunks,
  from,
}: {
  chunks: Readonly<Record<string, GuardedChunk>>;
  from: string;
}): string[] | null {
  const cameFrom = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  while (queue.length > 0) {
    const file = queue.shift()!;
    const chunk = chunks[file];
    if (!chunk) continue;
    if (chunk.name === SHIKI_CHUNK && file !== from) {
      const chain: string[] = [];
      for (let at: string | null = file; at !== null; at = cameFrom.get(at) ?? null) {
        chain.unshift(chunks[at]?.name ?? at);
      }
      return chain;
    }
    for (const next of chunk.imports) {
      if (cameFrom.has(next)) continue;
      cameFrom.set(next, file);
      queue.push(next);
    }
  }
  return null;
}

/** The build-time guard over the real output graph. */
export function shikiReachGuard(): Plugin {
  return {
    name: "langwatch:shiki-reach-guard",
    apply: "build",
    generateBundle(_options, bundle) {
      const chunks: Record<string, GuardedChunk> = {};
      for (const [file, output] of Object.entries(bundle)) {
        if (output.type === "chunk") chunks[file] = output;
      }
      const violations = shikiReachViolations({ chunks });
      if (violations.length === 0) return;
      this.error(
        "These chunks load the shiki chunk on every page that loads them:\n" +
          violations.map((chain) => `  ${chain.join(" -> ")}`).join("\n") +
          "\nReach Shiki through import() (the design system's shiki adapter does), or move the " +
          "module that imports it behind a lazy screen.",
      );
    },
  };
}
