/**
 * @vitest-environment node
 *
 * One avatar, one importer.
 *
 * The broken initials come from the component library itself, so a surface
 * that imports its avatar directly gets them back — silently, and only for
 * the names nobody tests with. Migrating every call site is therefore only
 * half a fix; this is the half that keeps it migrated.
 *
 * A source scan rather than an import-graph walk: what matters is the
 * specifier a file writes, and a file that writes `@chakra-ui/react` for the
 * avatar has already made the mistake, whatever the graph beneath it looks
 * like. Type-only names count too — `AvatarRootProps` is re-exported from the
 * wrapper, so there is never a reason to reach past it.
 *
 * @see specs/components/avatar-initials.feature
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** `platform/app/` — parent of `src/` and of the `ee/` tree. */
const APP_ROOT = path.resolve(HERE, "../../../..");
const ROOTS = ["src", "ee"];
const IGNORED_DIRECTORIES = new Set(["node_modules", "dist", "generated"]);

/** The wrapper itself, which is where the library's avatar is allowed. */
const ALLOWED = new Set([path.join("src", "components", "ui", "avatar.tsx")]);

const CHAKRA_IMPORT =
  /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']@chakra-ui\/react["']/gs;
const AVATAR_NAME = /^(?:type\s+)?Avatar\w*$/;

function* sourceFiles(directory: string): Generator<string> {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      yield* sourceFiles(path.join(directory, entry.name));
      continue;
    }
    if (/\.tsx?$/.test(entry.name)) yield path.join(directory, entry.name);
  }
}

function avatarImportersOfTheLibrary(): string[] {
  const offenders: string[] = [];
  for (const root of ROOTS) {
    const absoluteRoot = path.join(APP_ROOT, root);
    if (!fs.existsSync(absoluteRoot)) continue;
    for (const file of sourceFiles(absoluteRoot)) {
      const relative = path.relative(APP_ROOT, file);
      if (ALLOWED.has(relative)) continue;
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(CHAKRA_IMPORT)) {
        const names = (match[1] ?? "").split(",").map(
          (name) =>
            name
              .trim()
              .split(/\s+as\s+/)[0]
              ?.trim() ?? "",
        );
        if (names.some((name) => AVATAR_NAME.test(name))) {
          offenders.push(relative);
          break;
        }
      }
    }
  }
  return offenders.sort();
}

describe("given the application source", () => {
  /** @scenario "No surface reaches past it to the library's own avatar" */
  it("has no avatar imported from the component library outside the wrapper", () => {
    expect(avatarImportersOfTheLibrary()).toEqual([]);
  });

  it("finds the wrapper where the guard expects it, so the allowance is real", () => {
    for (const allowed of ALLOWED) {
      expect(fs.existsSync(path.join(APP_ROOT, allowed))).toBe(true);
    }
  });
});
