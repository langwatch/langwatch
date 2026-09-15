import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { SourceFile } from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";

// Owns the TypeScript 7 parsing session to avoid overhead; parses in temp
// directory to avoid loading the full project, and each parse uses a unique name.

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

/**
 * Ends the session, and with it the compiler child process. Also drops what
 * the session was holding on this side: every staged file's text, and the
 * temporary directory they were staged in. Without that a process that opens
 * and closes sessions keeps both, and neither is small — the overlay holds a
 * copy of every file the scans parsed.
 */
export function closeTsAstSession(): void {
  session?.close();
  session = undefined;
  overlay.clear();
  if (scratch) {
    rmSync(scratch, { recursive: true, force: true });
    scratch = undefined;
  }
  counter = 0;
}

/** Registers one file's text in the overlay and returns the path it took. */
function stage({ fileName, sourceText }: { fileName: string; sourceText: string }): string {
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

// Parse one source file; extension determines script kind (JSX, types, etc.).
// For tree-wide scans, use parseSourceTexts for efficiency.
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
