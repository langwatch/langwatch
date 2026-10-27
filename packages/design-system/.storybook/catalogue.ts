/**
 * Which story documents each published entry point. Shared by the adoption
 * collector (numbers on each docs page) and the catalogue test (no export
 * without a story), so the two cannot disagree.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");

type ExportTarget = string | { default: string };

export function publishedEntries(): { subpath: string; source: string }[] {
  const manifest = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")) as {
    exports: Record<string, ExportTarget>;
  };
  return Object.entries(manifest.exports).map(([subpath, target]) => ({
    subpath,
    source: typeof target === "string" ? target : target.default,
  }));
}

/** Entry points that render nothing a story could show, each with the reason. */
export const NOT_RENDERED: Record<string, string> = {
  "./provider": "mounted around every story by the preview",
  "./testing": "the test harness, not a screen element",
  "./color-mode": "documented by Foundations/Colour and Foundations/Tokens",
};

/**
 * The story file beside a source file, or the family story (`icons/icons.stories.tsx`)
 * when the file sits in a directory with an `index.ts`. `undefined` for a non-rendering
 * `.ts` helper that is not part of a family.
 */
export function storyFor({ source }: { source: string }): string | undefined {
  const dir = path.dirname(source);
  const absoluteDir = path.join(PACKAGE_ROOT, dir);
  const isFamily =
    dir.startsWith("./src/components/") && readdirSync(absoluteDir).includes("index.ts");
  if (isFamily) return `${dir}/${path.basename(dir)}.stories.tsx`;
  if (!source.endsWith(".tsx") && path.basename(source) !== "primitives.ts") return undefined;
  return source.replace(/\.tsx?$/, ".stories.tsx");
}

export function storyExists({ story }: { story: string }): boolean {
  return existsSync(path.join(PACKAGE_ROOT, story));
}
