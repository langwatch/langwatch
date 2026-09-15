import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/**
 * A module declares, in its own `feature.json`, the sibling web surfaces its
 * web package consumes: the browser catalogue keys entries by frontend feature
 * root, so a module that is no such root has none. See adrs/004, 2026-09-15.
 */
const featureWebDeclarationSchema = z
  .object({
    uses: z
      .object({
        surfaces: z.array(z.string()).default([]),
      })
      .strict(),
  })
  .strict();

export type FeatureWebDeclaration = z.infer<typeof featureWebDeclarationSchema>;

/** The complete key set a feature.json may carry. */
export const FEATURE_CONFIGURATION_KEYS: ReadonlySet<string> = new Set(["layoutVersion", "web"]);

export const FEATURE_WEB_DECLARATION_SHAPE =
  'Declare web uses as { "web": { "uses": { "surfaces": ["@langwatch/<feature>-web/surfaces/<id>"] } } }.';

/**
 * The `web` block of one parsed feature.json, or the reason it is unreadable.
 * A file with no `web` key declares nothing, which is not an error.
 */
export function parseFeatureWebDeclaration(value: unknown): {
  declaration: FeatureWebDeclaration | undefined;
  error: string | undefined;
} {
  if (typeof value !== "object" || value === null || !("web" in value)) {
    return { declaration: void 0, error: void 0 };
  }

  const result = featureWebDeclarationSchema.safeParse((value as { web: unknown }).web);

  if (!result.success) {
    return {
      declaration: void 0,
      error: result.error.issues
        .map((issue) => `web${issue.path.length > 0 ? `.${issue.path.join(".")}` : ""}: ${issue.message}`)
        .join("; "),
    };
  }

  return { declaration: result.data, error: void 0 };
}

/**
 * The surfaces one feature root declares. A missing, malformed or
 * `web`-less feature.json declares none; the shape violation itself is
 * reported once, where the file's schema is read.
 */
export function declaredFeatureWebSurfaces(featureRoot: string): readonly string[] {
  const path = join(featureRoot, "feature.json");
  if (!existsSync(path)) return [];

  let value: unknown;

  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return [];
  }

  return parseFeatureWebDeclaration(value).declaration?.uses.surfaces ?? [];
}
