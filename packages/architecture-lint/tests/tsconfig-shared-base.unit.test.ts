/**
 * @vitest-environment node
 *
 * @see specs/setup/typescript-7.feature — "Every package tsconfig extends the
 * shared root base", "Every package sets incremental with its own build info
 * file" and "Checking one package does not invalidate another's cache"
 *
 * One fact from three sides: the options every package shares are written once
 * at the root, and the one option that must NOT be shared — where a package
 * caches what it checked — is written per package and never twice.
 *
 * A shared build-info path is the failure worth a test. It is invisible: both
 * packages typecheck, both report clean, and each discards the other's cache,
 * so every check after the first starts cold. Nothing goes red; the whole repo
 * just gets slower.
 *
 * Only workspace members are subjects. `sdks/typescript/examples/*` and
 * `dev/dogfood/*` are standalone projects a reader copies out of the repo, and
 * a tsconfig of theirs naming a file at this root would compile nowhere else.
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
 *
 * The comment strip walks the text rather than running a regex over it: a glob
 * is not a comment, `"./examples/**\/*"` carries both delimiters inside a
 * string literal, and a regex blind to quotes eats the rest of the file.
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
      ...((own.compilerOptions as Record<string, unknown> | undefined) ?? {}),
    },
  };
}

const subjects = execFileSync(
  "git",
  ["ls-files", "-z", "--", "tsconfig*.json", "*/tsconfig*.json", "**/tsconfig*.json"],
  { cwd: REPO_ROOT, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 },
)
  .split("\0")
  .filter((file) => file.length > 0 && !file.includes("node_modules/"))
  .filter((file) => file !== "tsconfig.base.json")
  .filter((file) => !NON_MEMBER_PREFIXES.some((prefix) => file.startsWith(prefix)));

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
        const inside = relative(
          dirname(join(REPO_ROOT, file)),
          resolve(dirname(join(REPO_ROOT, file)), buildInfo),
        );
        if (!inside.startsWith("node_modules/.cache/tsbuildinfo/")) {
          return [
            `${file}: tsBuildInfoFile is ${buildInfo}, not under node_modules/.cache/tsbuildinfo`,
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
