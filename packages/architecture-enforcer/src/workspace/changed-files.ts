import { execFileSync } from "node:child_process";
import { extname, resolve, sep } from "node:path";

import { walkFiles } from "./layout.ts";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);

const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".next-saas",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "vendor",
]);

function isSourceFile(path: string): boolean {
  const extension = extname(path);
  if (!SOURCE_EXTENSIONS.has(extension)) return false;

  const segments = path.split(sep);

  for (const segment of segments) {
    if (EXCLUDED_DIRECTORIES.has(segment)) return false;
  }

  return !/\.(?:generated|gen)\.[cm]?[jt]sx?$/.test(path);
}

function trackedSourceFiles(root: string): string[] | undefined {
  try {
    execFileSync("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], {
      stdio: "ignore",
    });
  } catch {
    return void 0;
  }

  const paths = execFileSync("git", ["-C", root, "ls-files", "-z"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 16 * 1024 * 1024,
  });

  return paths
    .split("\0")
    .filter((path) => path.length > 0)
    .map((path) => resolve(root, path))
    .filter(isSourceFile)
    .toSorted();
}

function allSourceFiles(root: string): string[] {
  return (
    trackedSourceFiles(root) ??
    walkFiles(root, isSourceFile, { ignoredDirectories: EXCLUDED_DIRECTORIES })
  );
}

function gitOutput(root: string, arguments_: string[]): string | undefined {
  try {
    return execFileSync("git", ["-C", root, ...arguments_], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return void 0;
  }
}

function gitPaths(root: string, arguments_: string[]): string[] {
  return (gitOutput(root, arguments_) ?? "")
    .split("\0")
    .filter((path) => path.length > 0)
    .map((path) => resolve(root, path))
    .filter(isSourceFile);
}

function mergeBase(root: string): string | undefined {
  for (const reference of ["@{upstream}", "origin/main", "main"]) {
    const base = gitOutput(root, ["merge-base", "HEAD", reference])?.trim();
    if (base) return base;
  }

  return gitOutput(root, ["rev-parse", "HEAD^"])?.trim();
}

/**
 * Finds source files introduced since the branch base, modified locally, or
 * untracked. This lets the hard rule apply to new code without a baseline.
 */
export function changedSourceFiles(root: string): string[] {
  const resolvedRoot = resolve(root);

  if (!gitOutput(resolvedRoot, ["rev-parse", "--is-inside-work-tree"])) {
    return allSourceFiles(resolvedRoot);
  }

  const paths = new Set([
    ...gitPaths(resolvedRoot, ["diff", "--name-only", "-z", "--diff-filter=ACMR", "HEAD"]),
    ...gitPaths(resolvedRoot, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);

  const base = mergeBase(resolvedRoot);

  if (base) {
    for (const path of gitPaths(resolvedRoot, [
      "diff",
      "--name-only",
      "-z",
      "--diff-filter=ACMR",
      `${base}...HEAD`,
    ])) {
      paths.add(path);
    }
  }

  return [...paths].toSorted();
}
