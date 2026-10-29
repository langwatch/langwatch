import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { directoryDigest, workspacePackages } from "./build-inputs.ts";

/** Written by build.ts for the prerender: page keys, the cache folder and renderer threads. */
export const prerenderPlanSchema = z.object({
  keys: z.record(z.string(), z.string()),
  cacheDir: z.string().nullable(),
  workers: z.number().int().positive().optional(),
});
export type PrerenderPlan = z.infer<typeof prerenderPlanSchema>;
/** The plan sits beside the bundle it was written for. */
export const PRERENDER_PLAN_FILE = "prerender-plan.json";

/** The slice of a bundled chunk a render key reads. */
export type BundledChunk = {
  fileName: string;
  code: string;
  isEntry: boolean;
  imports: string[];
  dynamicImports: string[];
  moduleIds: string[];
};

/** `@scope/name/sub` and `name/sub` to their package name; relative or absolute ids to null. */
function packageName({ id }: { id: string }) {
  const local = /^(?:\.|\/|\0|node:)/.test(id);
  if (local) return null;
  const parts = id.split("/");
  return id.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

const packageManifestSchema = z.looseObject({ version: z.string() });

const SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;
const SOURCE_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".mjs"];

/**
 * Source files the bundle imports by absolute path instead of bundling (the highlighter), each
 * by content, following their relative imports; the packages they import join `names`.
 */
function externalSources({
  files,
  names,
  repoRoot,
}: {
  files: string[];
  names: Set<string>;
  repoRoot: string;
}) {
  const seen = new Map<string, string>();
  const pending = [...files];
  for (let file = pending.pop(); file; file = pending.pop()) {
    if (seen.has(file)) continue;
    const source = readFileSync(file, "utf8");
    seen.set(file, createHash("sha256").update(source).digest("hex"));
    for (const [, specifier = ""] of source.matchAll(SPECIFIER)) {
      const name = packageName({ id: specifier });
      if (name) names.add(name);
      else if (specifier.startsWith(".")) pending.push(...resolveSource({ file, specifier }));
    }
  }
  return [...seen].map(([file, digest]) => `${path.relative(repoRoot, file)}:${digest}`).toSorted();
}

function resolveSource({ file, specifier }: { file: string; specifier: string }) {
  const base = path.resolve(path.dirname(file), specifier);
  const found = SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`).find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );
  return found ? [found] : [];
}

/** A workspace package's source with that of every workspace package it depends on at runtime. */
async function workspaceSource({ directory, repoRoot }: { directory: string; repoRoot: string }) {
  const digests: string[] = [];
  for (const member of workspacePackages({ appRoot: directory, withBuildDependencies: false }))
    digests.push(
      `${path.relative(repoRoot, member)}=${await directoryDigest({ directory: member })}`,
    );
  return digests.join(",");
}

/** The lockfile pins every installed package, including overrides beneath an unchanged one. */
function lockfileDigest({ repoRoot }: { repoRoot: string }) {
  const lockfile = path.join(repoRoot, "pnpm-lock.yaml");
  const contents = existsSync(lockfile) ? readFileSync(lockfile) : "no lockfile";
  return createHash("sha256").update(contents).digest("hex");
}

/**
 * Everything the bundle leaves to Node at render: absolute source files by content, installed
 * packages by name, version and repository-relative install, and workspace packages, whose
 * version never moves, by their source.
 */
async function externalPackages({
  chunks,
  repoRoot,
  appRoot,
}: KeyRoots & { chunks: BundledChunk[] }) {
  const bundled = new Set(chunks.map((chunk) => chunk.fileName));
  const names = new Set<string>();
  const files: string[] = [];
  for (const chunk of chunks) {
    for (const id of [...chunk.imports, ...chunk.dynamicImports]) {
      if (bundled.has(id)) continue;
      const name = packageName({ id });
      const sourceFile = !name && path.isAbsolute(id);
      if (name) names.add(name);
      else if (sourceFile && existsSync(id)) files.push(id);
    }
  }
  const identities = externalSources({ files, names, repoRoot });
  for (const name of [...names].toSorted()) {
    const directory = realpathSync(path.join(appRoot, "node_modules", name));
    const manifest = path.join(directory, "package.json");
    const { version } = packageManifestSchema.parse(JSON.parse(readFileSync(manifest, "utf8")));
    const installed = directory.split(path.sep).includes("node_modules");
    const source = installed ? "" : await workspaceSource({ directory, repoRoot });
    identities.push(`${name}@${version}:${path.relative(repoRoot, directory)}:${source}`);
  }
  return identities;
}

function stableNames({ chunks, repoRoot }: { chunks: BundledChunk[]; repoRoot: string }) {
  return new Map(
    chunks.map((chunk) => {
      const modules = chunk.moduleIds.map((id) =>
        id.startsWith("/") ? path.relative(repoRoot, id) : id,
      );
      const name = createHash("sha256").update(modules.toSorted().join("\n")).digest("hex");
      return [chunk.fileName, `chunk:${name}`];
    }),
  );
}

/** Absolute roots, so keys are written relative to the repository and portable between hosts. */
type KeyRoots = { repoRoot: string; appRoot: string };

type ChunkGraph = {
  byFile: Map<string, BundledChunk>;
  names: Map<string, string>;
  digests: Map<string, string>;
  repoRoot: string;
};

/** A chunk's code with every chunk file name in it replaced by that chunk's stable name. */
function digest({ graph, chunk }: { graph: ChunkGraph; chunk: BundledChunk }) {
  const known = graph.digests.get(chunk.fileName);
  if (known) return known;
  let code = chunk.code.replaceAll(graph.repoRoot, "<repository>");
  for (const [fileName, name] of graph.names) code = code.replaceAll(fileName, name);
  const value = createHash("sha256").update(code).digest("hex");
  graph.digests.set(chunk.fileName, value);
  return value;
}

/** Stable name and digest of every chunk reachable from `roots`, in a fixed order. */
function closure({
  graph,
  roots,
  dynamic,
}: {
  graph: ChunkGraph;
  roots: BundledChunk[];
  dynamic: boolean;
}) {
  const seen = new Map<string, BundledChunk>();
  const pending = [...roots];
  for (let chunk = pending.pop(); chunk; chunk = pending.pop()) {
    if (seen.has(chunk.fileName)) continue;
    seen.set(chunk.fileName, chunk);
    const ids = dynamic ? [...chunk.imports, ...chunk.dynamicImports] : chunk.imports;
    pending.push(...ids.flatMap((id) => graph.byFile.get(id) ?? []));
  }
  return [...seen.entries()]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([file, chunk]) => `${graph.names.get(file)}=${digest({ graph, chunk })}`)
    .join("\n");
}

/**
 * One key per page slug over everything its prerender reads: the entry and its static imports
 * (renderer, navigation, design system), the page's own MDX and operation chunks with their
 * imports (snippets, release notes, diagrams), the external package versions and Node itself.
 */
export async function pageRenderKeys({
  chunks,
  slugs,
  docsRoot,
  appRoot,
}: {
  chunks: BundledChunk[];
  slugs: string[];
  docsRoot: string;
  appRoot: string;
}): Promise<Record<string, string>> {
  const repoRoot = path.resolve(appRoot, "../..");
  const graph: ChunkGraph = {
    byFile: new Map(chunks.map((chunk) => [chunk.fileName, chunk])),
    names: stableNames({ chunks, repoRoot }),
    digests: new Map(),
    repoRoot,
  };
  const byModule = new Map(chunks.flatMap((chunk) => chunk.moduleIds.map((id) => [id, chunk])));
  const shared = createHash("sha256")
    .update(closure({ graph, roots: chunks.filter((chunk) => chunk.isEntry), dynamic: false }))
    .update((await externalPackages({ chunks, repoRoot, appRoot })).join("\n"))
    .update(lockfileDigest({ repoRoot }))
    .update(`${process.version} ${process.platform} ${process.arch}`)
    .update(`${path.relative(repoRoot, docsRoot)} ${path.relative(repoRoot, appRoot)}`)
    .digest("hex");
  const keys: Record<string, string> = {};
  for (const slug of slugs) {
    const roots = [path.join(docsRoot, `${slug}.mdx`), `\0virtual:docs-op/${slug}`]
      .map((id) => byModule.get(id))
      .filter((chunk) => chunk !== undefined);
    keys[slug] = createHash("sha256")
      .update(shared)
      .update(slug)
      .update(closure({ graph, roots, dynamic: true }))
      .digest("hex");
  }
  return keys;
}

/** A page's cache key: its bundle key and the build context (template, islands, nav, base). */
export function pageCacheKey({ pageKey, context }: { pageKey: string; context: unknown }) {
  return createHash("sha256").update(pageKey).update(JSON.stringify(context)).digest("hex");
}
