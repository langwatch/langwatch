import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { SourceFile } from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";

/**
 * Getting a parsed `SourceFile` out of TypeScript 7.
 *
 * TypeScript 7 is the native compiler, and it did not bring the old
 * `ts.createSourceFile(fileName, text, target)` with it. The JS package's root
 * export is a version constant; the compiler lives behind
 * `typescript/unstable/*`, where parsing is a request to the Go binary rather
 * than work done in this process. Nothing parses a string in-process any more,
 * so the static scans that used to call `createSourceFile` need a session.
 *
 * That session is what this module owns, and owning it in one place is the
 * point: the API spawns a `tsgo` child, so a scan that opened its own would pay
 * for a process per call.
 *
 * Two details are load-bearing, and both were found by the tests rather than
 * reasoned out:
 *
 *   - **Every parse happens under a temporary directory**, never under a path
 *     inside the repo. Opening a file makes the Go side search its ancestors
 *     for a tsconfig that claims it, and a synthetic path under `platform/app`
 *     is claimed by the app's — so parsing one snippet loaded the whole
 *     52 MB project and took longer than a test timeout. Nothing above the
 *     temporary directory is a tsconfig, so each file lands in an inferred
 *     project of its own, which is all a syntactic scan needs.
 *
 *   - **Each parse gets a name no earlier parse used.** The session caches
 *     source files by path, so re-parsing a name returned the first text and a
 *     scan pinning a rule across several snippets judged all of them by the
 *     first.
 *
 * The scans built on this: `mockSpecifierScan`, `teardownScan`,
 * `vitestAliasTable`, and the ClickHouse `replicatedEngineGuard` test. All four
 * take the file's real directory as its own argument, so none of them needs the
 * parsed file to sit where the original does. See ADR-099.
 */

/**
 * Text for the files this module invents, keyed by the path it invented. The
 * session reads it through virtual-filesystem callbacks, which are closures
 * over this map — that is what lets one session serve text it had never heard
 * of when it started.
 */
const overlay = new Map<string, string>();

let session: API | undefined;
let scratch: string | undefined;
let counter = 0;

/**
 * The one API session, started on first use. The channel unrefs its child, so
 * an open session does not by itself keep a process alive; `closeTsAstSession`
 * is for suites that want the `tsgo` child gone before they finish.
 *
 * `readFile` returning undefined means "not mine" and falls through to the real
 * filesystem, which is how the session still finds the default library.
 */
function apiSession(): API {
  session ??= new API({
    cwd: scratchDir(),
    fs: {
      readFile: (name) => overlay.get(name),
      fileExists: (name) => (overlay.has(name) ? true : undefined),
    },
  });
  return session;
}

/** A directory with no tsconfig anywhere above it. */
function scratchDir(): string {
  scratch ??= mkdtempSync(join(tmpdir(), "langwatch-ts-ast-"));
  return scratch;
}

/** Ends the session, and with it the compiler child process. */
export function closeTsAstSession(): void {
  session?.close();
  session = undefined;
}

/** Registers one file's text in the overlay and returns the path it took. */
function stage({
  fileName,
  sourceText,
}: {
  fileName: string;
  sourceText: string;
}): string {
  counter += 1;
  const path = join(scratchDir(), `${counter}-${basename(fileName)}`);
  overlay.set(path, sourceText);
  return path;
}

/** Pulls one staged path's parsed form out of an updated snapshot. */
function sourceFileFrom({
  snapshot,
  path,
  fileName,
}: {
  snapshot: ReturnType<API["updateSnapshot"]>;
  path: string;
  fileName: string;
}): SourceFile {
  const project = snapshot.getDefaultProjectForFile(path);
  if (!project) {
    throw new Error(`no TypeScript project would load ${fileName}`);
  }
  const sourceFile = project.program.getSourceFile(path);
  if (!sourceFile) {
    throw new Error(`${fileName} parsed into no source file`);
  }
  return sourceFile;
}

/**
 * The parsed form of source text, under a name that keeps the original's
 * extension — which is what decides the script kind, and so whether JSX and
 * type annotations parse at all.
 *
 * One call is one round trip to the compiler. Scanning a whole tree file by
 * file through here pays that per file; `parseSourceTexts` is the same work in
 * one trip and is what the tree-wide scans use.
 */
export function parseSourceText({
  fileName,
  sourceText,
}: {
  fileName: string;
  sourceText: string;
}): SourceFile {
  const path = stage({ fileName, sourceText });
  const snapshot = apiSession().updateSnapshot({ openFiles: [path] });
  return sourceFileFrom({ snapshot, path, fileName });
}

/**
 * The parsed form of many sources, in one exchange with the compiler, keyed by
 * the file name each was given. Names may repeat: each entry is staged under a
 * path of its own, so a caller scanning two files that happen to share a
 * basename gets two answers.
 */
export function parseSourceTexts({
  sources,
}: {
  sources: readonly { fileName: string; sourceText: string }[];
}): { fileName: string; source: SourceFile }[] {
  const staged = sources.map((source) => ({
    ...source,
    path: stage(source),
  }));

  const snapshot = apiSession().updateSnapshot({
    openFiles: staged.map(({ path }) => path),
  });

  return staged.map(({ fileName, path }) => ({
    fileName,
    source: sourceFileFrom({ snapshot, path, fileName }),
  }));
}
