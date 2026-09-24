/**
 * @vitest-environment node
 * @see specs/setup/typescript-7.feature
 */

/**
 * Options every package shares are written once at the root; the one that
 * must NOT be shared — a package's own build-info cache path — is written
 * per package, or both typecheck clean while silently discarding each other's cache.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const BASE = join(REPO_ROOT, "tsconfig.base.json");

/** The two project trees that are deliberately not workspace members. */
const NON_MEMBER_PREFIXES = ["sdks/typescript/examples/", "dev/dogfood/"];

/**
 * A tsconfig read as JSON with comments — which every one of these files is.
 * The strip walks the text rather than regexing it: a glob is not a comment,
 * and a string literal can carry both comment delimiters without being one.
 */
function readTsconfig(file: string): Record<string, unknown> {
  const raw = readFileSync(file, "utf8");
  let text = "";
  let inString = false;
  for (let at = 0; at < raw.length; at++) {
    const here = raw[at]!;
    if (inString) {
      text += here;
      if (here === "\\") text += raw[++at] ?? "";
      else if (here === '"') inString = false;
      continue;
    }
    if (here === '"') {
      inString = true;
      text += here;
      continue;
    }
    if (here === "/" && raw[at + 1] === "/") {
      while (at < raw.length && raw[at] !== "\n") at++;
      text += "\n";
      continue;
    }
    if (here === "/" && raw[at + 1] === "*") {
      at = raw.indexOf("*/", at + 2) + 1;
      continue;
    }
    text += here;
  }
  return JSON.parse(text.replace(/,(\s*[}\]])/g, "$1")) as Record<string, unknown>;
}

type Resolved = Readonly<{
  /** Every file in the extends chain, nearest first, ending at the root base. */
  chain: readonly string[];
  options: Record<string, unknown>;
}>;

/** The effective configuration, following `extends` the way the compiler does. */
function resolveTsconfig(file: string): Resolved {
  const own = readTsconfig(file);
  const parent = typeof own.extends === "string" ? resolve(dirname(file), own.extends) : undefined;
  const inherited = parent ? resolveTsconfig(parent) : { chain: [], options: {} };
  return {
    chain: [...(parent ? [parent] : []), ...inherited.chain],
    options: {
      ...inherited.options,
      ...(own.compilerOptions as Record<string, unknown> | undefined),
    },
  };
}

/**
 * A solution names other projects and compiles nothing itself (the root `tsconfig.json`, the two
 * declaration groups under `dev/`), so none of the package rules below apply to it.
 */
function isSolution(file: string): boolean {
  const config = readTsconfig(join(REPO_ROOT, file));
  const files = config.files;

  return Array.isArray(files) && files.length === 0 && config.compilerOptions === void 0;
}

/**
 * The directory of the package a project belongs to: the nearest ancestor with a manifest. A
 * project may keep its build info anywhere inside that package -- the mail preview studio emits
 * into `packages/mail/dist`, so its build info belongs there too -- and nowhere outside it.
 */
function owns(project: string, buildInfo: string): boolean {
  let directory = dirname(project);
  while (directory.startsWith(REPO_ROOT)) {
    if (existsSync(join(directory, "package.json"))) {
      return !relative(directory, buildInfo).startsWith("..");
    }
    directory = dirname(directory);
  }

  return !relative(REPO_ROOT, buildInfo).startsWith("..");
}

const subjects = execFileSync(
  "git",
  ["ls-files", "-z", "--", "tsconfig*.json", "*/tsconfig*.json", "**/tsconfig*.json"],
  { cwd: REPO_ROOT, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 },
)
  .split("\0")
  .filter((file) => file.length > 0 && !file.includes("node_modules/"))
  .filter((file) => file !== "tsconfig.base.json")
  // Not a project of the workspace graph: it emits the published artefact under
  // the pinned sdk toolchain and deliberately inherits none of the repo's
  // options, which is what its own comment says and why it extends nothing.
  .filter((file) => file !== "packages/ksuid/tsconfig.publish.json")
  .filter((file) => !NON_MEMBER_PREFIXES.some((prefix) => file.startsWith(prefix)))
  .filter((file) => !isSolution(file));

describe("given the workspace's TypeScript projects", () => {
  it("finds every one of them", () => {
    expect(subjects.length).toBeGreaterThan(200);
    expect(existsSync(BASE)).toBe(true);
  });

  describe("when a package's tsconfig is read", () => {
    /** @scenario "Every package tsconfig extends the shared root base" */
    it("resolves through extends to the shared root base", () => {
      const detached = subjects.filter(
        (file) => !resolveTsconfig(join(REPO_ROOT, file)).chain.includes(BASE),
      );

      expect(detached).toEqual([]);
    });
  });

  describe("when a package is typechecked", () => {
    /** @scenario "Every package sets incremental with its own build info file" */
    it("caches what it checked, under a path scoped to that package", () => {
      const wrong = subjects.flatMap((file) => {
        const { options } = resolveTsconfig(join(REPO_ROOT, file));
        const buildInfo = options.tsBuildInfoFile;
        if (options.incremental !== true) return [`${file}: incremental is not true`];
        if (typeof buildInfo !== "string") return [`${file}: no tsBuildInfoFile`];
        const resolvedBuildInfo = resolve(dirname(join(REPO_ROOT, file)), buildInfo);
        const inside = relative(dirname(join(REPO_ROOT, file)), resolvedBuildInfo);
        const ownsBuildInfo = owns(join(REPO_ROOT, file), resolvedBuildInfo);
        // Build info belongs beside what the project produces, which for all
        // but two projects is its own `dist`. Under node_modules it is wrong
        // twice: an install wipes it, and clearing the output directory leaves
        // it behind, so the next build reads an up-to-date project and emits
        // nothing into the directory that was just deleted.
        if (!ownsBuildInfo || inside.includes("node_modules/")) {
          return [
            `${file}: tsBuildInfoFile is ${buildInfo}, which is not inside the project's own output`,
          ];
        }
        return [];
      });

      expect(wrong).toEqual([]);
    });
  });

  describe("when two projects are checked in turn", () => {
    /** @scenario "Checking one package does not invalidate another's cache" */
    it("writes each one's build info to a path no other project names", () => {
      const owners = new Map<string, string>();
      const collisions: string[] = [];
      for (const file of subjects) {
        const { options } = resolveTsconfig(join(REPO_ROOT, file));
        const buildInfo = options.tsBuildInfoFile;
        if (typeof buildInfo !== "string") continue;
        const absolute = resolve(dirname(join(REPO_ROOT, file)), buildInfo);
        const owner = owners.get(absolute);
        if (owner) collisions.push(`${file} shares ${buildInfo} with ${owner}`);
        else owners.set(absolute, file);
      }

      expect(collisions).toEqual([]);
    });
  });
});
