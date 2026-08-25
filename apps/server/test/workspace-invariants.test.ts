import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_PACKAGE_NAME, workspaceInstallArgs } from "../src/services/node-deps";

/**
 * The invariants ADR-076 established, asserted against the repo itself.
 *
 * These are cheap to state and expensive to lose: every one of them held at
 * some point during the merge and then quietly broke — a second lockfile
 * reappearing, a member keeping its own overrides (which pnpm ignores, so it
 * reads as an active security pin while doing nothing), the app and the SDK
 * colliding on a package name again. None of that surfaces as a test failure
 * anywhere else; it surfaces as a drifted dependency months later.
 */

const repoRoot = join(__dirname, "..", "..", "..");

function readJson(relPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(repoRoot, relPath), "utf8"));
}

function gitLsFiles(pattern: string): string[] {
  return execFileSync("git", ["ls-files", pattern], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
}

/**
 * The `packages:` list from pnpm-workspace.yaml. A line scan rather than a
 * YAML parser: the list is flat quoted strings, and pulling in a parser as a
 * devDependency for one test buys nothing over twelve lines that fail loudly —
 * an empty result fails both the member-count assertion and the sanity check
 * below.
 */
function workspaceMembers(): string[] {
  const lines = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8").split("\n");
  const start = lines.findIndex((l) => l.trimEnd() === "packages:");
  if (start === -1) return [];

  const members: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const entry = /^\s+-\s+"?([^"#]+?)"?\s*$/.exec(line);
    if (entry?.[1]) {
      members.push(entry[1]);
      continue;
    }
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    break; // the next top-level key ends the list
  }
  return members;
}

/** The keys of the root `overrides:` block, same line-scan approach. */
function rootOverrideKeys(): string[] {
  const lines = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8").split("\n");
  const start = lines.findIndex((l) => l.trimEnd() === "overrides:");
  if (start === -1) return [];

  const keys: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(line)) break; // next top-level key
    const m = /^\s+"?([^"]+?)"?:/.exec(line);
    if (m?.[1]) keys.push(m[1]);
  }
  return keys;
}

/** Every package.json the repo tracks, excluding installed dependencies. */
function trackedManifests(): string[] {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "*package.json"],
    { cwd: repoRoot, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean)
    .filter((p) => !p.includes("node_modules") && existsSync(join(repoRoot, p)));
}

/** Directory of a manifest, "" for the root one. */
function manifestDir(manifest: string): string {
  return manifest.replace(/\/?package\.json$/, "");
}

/** Whether dir is a workspace member per the `packages:` globs. */
function isWorkspaceMember(dir: string): boolean {
  if (dir === "") return false;
  const directoryParts = dir.split("/");
  return workspaceMembers().some((glob) => {
    const globParts = glob.split("/");
    return (
      globParts.length === directoryParts.length &&
      globParts.every((part, index) => part === "*" || part === directoryParts[index])
    );
  });
}

describe("the repo is a single pnpm workspace", () => {
  describe("when the lockfiles are counted", () => {
    /** @scenario The repo holds one lockfile */
    it("finds exactly one, at the repo root", () => {
      expect(gitLsFiles("*pnpm-lock.yaml")).toEqual(["pnpm-lock.yaml"]);
    });
  });

  describe("when the workspace definition is read", () => {
    /** @scenario Projects that used to opt out of the workspace no longer do */
    it("lists every JavaScript project the repo used to install separately", () => {
      const members = workspaceMembers();

      for (const project of [
        "platform/app",
        "sdks/typescript",
        "mcp/typescript",
        "skills",
        "tests/agentic-e2e",
      ]) {
        expect(members).toContain(project);
      }
    });

    /** @scenario The repo holds one lockfile */
    it("keeps the workspace definition at the repo root and nowhere else", () => {
      expect(gitLsFiles("*pnpm-workspace.yaml")).toEqual(["pnpm-workspace.yaml"]);
    });
  });

  describe("when the package names are compared", () => {
    /** @scenario The application and the SDK no longer share a package name */
    it("gives the app the name the npx installer filters by, and the SDK its own", () => {
      const app = readJson("platform/app/package.json").name;
      const sdk = readJson("sdks/typescript/package.json").name;

      // Cross-checked against the constant the end-user install filters
      // by, not against a literal: pnpm exits 0 on a filter that matches
      // nothing, so a rename that misses node-deps.ts turns every npx
      // first boot into a silent no-op that fails minutes later inside a
      // migration. This is the only assertion tying the two together.
      expect(app).toBe(APP_PACKAGE_NAME);
      expect(sdk).toBe("langwatch");
      expect(app).not.toBe(sdk);
    });

    /** @scenario The application links the SDK working copy */
    it("links the SDK working copy rather than a published release", () => {
      const app = readJson("platform/app/package.json") as {
        dependencies?: Record<string, string>;
      };

      // So an SDK edit reaches the app — and the production image built
      // from it — without a publish. `linkWorkspacePackages` stays false,
      // so this only happens for the specifier that asks for it.
      expect(app.dependencies?.langwatch).toMatch(/^workspace:/);
    });

    /** @scenario The SDK carries its own copy of a pinned dependency */
    it("bundles zod into the SDK instead of importing it from the consumer", () => {
      const bundle = join(repoRoot, "sdks/typescript/dist/index.mjs");
      if (!existsSync(bundle)) return; // dist is a build artefact, not tracked

      // The link above is only survivable because of this. Left external, a
      // consumer-selected incompatible Zod runtime could replace the SDK's
      // tested runtime and fail at first import, taking down the app rather
      // than only the SDK path.
      const source = readFileSync(bundle, "utf8");
      const externalZodImports = source.match(/from\s*["']zod(?:\/[^"']*)?["']/g);

      expect(externalZodImports ?? []).toEqual([]);
    });
  });

  describe("when a member carries install configuration of its own", () => {
    /** @scenario No project keeps a dependency rule that no longer applies */
    it("finds no member holding dependency rules pnpm would ignore", () => {
      // pnpm honours these only in the workspace ROOT manifest: the whole
      // `pnpm` block (overrides, packageExtensions, onlyBuiltDependencies,
      // patchedDependencies, ...) and yarn-style `resolutions`. One left in
      // a member looks like an active pin and does nothing — which is
      // exactly how the six old roots drifted apart.
      const offenders: string[] = [];
      for (const manifest of trackedManifests()) {
        if (manifest === "package.json") continue;
        const pkg = readJson(manifest) as {
          pnpm?: Record<string, unknown>;
          resolutions?: Record<string, unknown>;
        };
        for (const key of Object.keys(pkg.pnpm ?? {})) {
          offenders.push(`${manifest}: pnpm.${key}`);
        }
        if (pkg.resolutions !== undefined) {
          offenders.push(`${manifest}: resolutions`);
        }
      }
      expect(offenders).toEqual([]);
    });

    /** @scenario No project keeps a dependency rule that no longer applies */
    it("finds no .npmrc outside the repo root", () => {
      // An .npmrc is read from the install root, which is the repo root
      // now. A member one is dead config that still READS as active —
      // skills/.npmrc held a release-age exemption for @langwatch/scenario
      // that silently stopped applying the day the roots merged.
      expect(gitLsFiles("*.npmrc")).toEqual([".npmrc"]);
    });
  });

  describe("when the root overrides are read", () => {
    /** @scenario A pin that suits one project is not forced onto the others */
    it("carries no unconditional pin for the packages the projects disagree on", () => {
      // Three projects legitimately sit on three zod majors (app 3.x,
      // SDK 4.0, MCP server 4.3), and the SDK's OTel logs pins are older
      // than the app's stack. Each was deliberately NOT carried into the
      // root list — as a direct dependency, the owning project's own
      // declaration governs it. An unconditional root pin (a bare package
      // name, no `@range` selector) would drag every project onto one
      // version; a future merge adding one back must fail here.
      const disputed = ["zod", "@opentelemetry/api-logs", "@opentelemetry/sdk-logs"];
      const unconditional = rootOverrideKeys().filter(
        (k) => !k.replace(/^@/, "").includes("@"),
      );

      // Guards the guard: the parser returning nothing would pass
      // vacuously. The alignment block genuinely holds unconditional keys.
      expect(unconditional.length).toBeGreaterThan(3);

      for (const name of disputed) {
        expect(
          unconditional,
          `root overrides pin ${name} for every project`,
        ).not.toContain(name);
      }
    });
  });

  describe("when a member depends on an internal package", () => {
    /** @scenario A shared internal package is reachable from every project */
    it("resolves every internal dependency to the working copy", () => {
      // Generalised over every member and every internal name, because the
      // invariant is about the workspace, not about one pair: any member
      // declaring a dependency on a package that lives in this repo must
      // take the working copy. The one documented exception is `langwatch`
      // — the published SDK — which the app consumes from the registry on
      // purpose (see "keeps the app on the published SDK" above).
      const internalNames = new Set(
        trackedManifests()
          .map((m) => readJson(m).name)
          .filter((n): n is string => typeof n === "string"),
      );

      const offenders: string[] = [];
      let internalDepsSeen = 0;
      for (const manifest of trackedManifests()) {
        const dir = manifestDir(manifest);
        if (!isWorkspaceMember(dir)) continue;
        const pkg = readJson(manifest) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        for (const [name, spec] of Object.entries({
          ...pkg.dependencies,
          ...pkg.devDependencies,
        })) {
          if (!internalNames.has(name) || name === "langwatch") continue;
          internalDepsSeen++;
          if (!spec.startsWith("workspace:")) {
            offenders.push(`${manifest}: ${name} -> ${spec}`);
          }
        }
      }

      // Guards the guard: zero internal dependencies found would mean the
      // scan is broken, not that the repo is clean.
      expect(internalDepsSeen).toBeGreaterThan(5);
      expect(offenders).toEqual([]);
    });
  });

  describe("when the published package manifest is read", () => {
    it("keeps publishing ownership in apps/server", () => {
      const root = readJson("package.json") as {
        name?: string;
        private?: boolean;
        bin?: Record<string, string>;
        files?: string[];
      };
      const server = readJson("apps/server/package.json") as {
        name?: string;
        private?: boolean;
        bin?: Record<string, string>;
      };

      expect(root.name).toBe("@langwatch/workspace");
      expect(root.private).toBe(true);
      expect(root.bin).toBeUndefined();
      expect(root.files).toBeUndefined();
      expect(server.name).toBe("@langwatch/server");
      expect(server.private).not.toBe(true);
      expect(server.bin).toEqual({ "langwatch-server": "dist/cli.cjs" });
    });

    it("stages the workspace definition and the lockfile", () => {
      // Necessary, not sufficient: the distribution manifest drives what
      // pack-npm.sh stages, but npm deletes a package-root lockfile. The
      // packing script and smoke job assert that the nested copy survives.
      const shipped = readJson("apps/server/distribution-files.json") as unknown;

      expect(shipped).toBeInstanceOf(Array);
      expect(shipped).toContain("pnpm-workspace.yaml");
      expect(shipped).toContain("pnpm-lock.yaml");
    });

    /** @scenario Every project the lockfile mentions is resolvable */
    it("ships a manifest for every workspace member", () => {
      const shipped = readJson(
        "apps/server/distribution-files.json",
      ) as unknown as string[];

      // Workspace members only — `sdks/typescript/examples/*` carry a
      // package.json but are not members, so the lockfile never mentions
      // them and the tarball has no reason to.
      const memberManifests = trackedManifests().filter((manifest) =>
        isWorkspaceMember(manifestDir(manifest)),
      );

      expect(memberManifests.length).toBeGreaterThan(5);

      // A member whose directory is absent installs without complaint and
      // fails much later, inside a migration.
      for (const manifest of memberManifests) {
        // Compare against a directory prefix that definitely ends in "/",
        // so a distribution entry of `langwatch` cannot be read as shipping
        // `langwatch-something/package.json`.
        const covered = shipped.some(
          (f) => manifest === f || manifest.startsWith(f.endsWith("/") ? f : `${f}/`),
        );
        expect(covered, `no distribution entry ships ${manifest}`).toBe(true);
      }
    });
  });

  describe("when the end-user install arguments are built", () => {
    /** @scenario The install still refuses to drift from the lockfile */
    it("pins both install passes to the lockfile and to the app's closure", () => {
      // Both invariants an `npx @langwatch/server` first boot depends on:
      // --frozen-lockfile makes the install reproducible-or-failed, and the
      // `...` filter keeps the SDK, skills compiler and test suites off the
      // end user's machine. This PR rewrote these argv twice; they are the
      // most likely thing to lose in a refactor.
      for (const prod of [true, false]) {
        const args = workspaceInstallArgs("/some/root", { prod });
        expect(args).toContain("--frozen-lockfile");
        expect(args).toContain(`${APP_PACKAGE_NAME}...`);
        expect(args).toContain(prod ? "--prod" : "--prod=false");
      }
    });
  });
});
