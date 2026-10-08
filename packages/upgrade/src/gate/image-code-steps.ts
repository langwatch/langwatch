import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { ManifestLoadError, type ManifestStep, manifestStepSchema } from "../manifest/manifest.ts";

/**
 * The code steps this image's tasks process collects, generated at build because the api builds
 * none (coordinator ruling R1, 2026-10-08). A folder of its own: every `.json` directly in
 * `releases/` is read as a release manifest. Spec: packages/upgrade/specs/image-code-steps.feature.
 */
export const IMAGE_CODE_STEPS_FILE = fileURLToPath(
  new URL("../../releases/image/code-steps.json", import.meta.url),
);

/** What rewrites the file; a stale-list failure names it. */
export const IMAGE_CODE_STEPS_COMMAND =
  "node --experimental-transform-types packages/upgrade/scripts/image-code-steps.ts";

/** Parses a code step list, refusing a file that is not one by name. */
export function parseImageCodeSteps({
  name,
  text,
}: {
  name: string;
  text: string;
}): ManifestStep[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new ManifestLoadError({
      code: "invalid_manifest",
      message: `${name} is not JSON: ${(error as Error).message}`,
    });
  }
  const parsed = z.array(manifestStepSchema).safeParse(json);
  if (!parsed.success) {
    throw new ManifestLoadError({
      code: "invalid_manifest",
      message: `${name} is not a code step list: ${parsed.error.message}`,
    });
  }
  return parsed.data;
}

/** The image's code step list, as the api and worker gates read it. */
export function readImageCodeSteps({
  file = IMAGE_CODE_STEPS_FILE,
}: { file?: string } = {}): ManifestStep[] {
  return parseImageCodeSteps({ name: file, text: readFileSync(file, "utf8") });
}

/** One line per step that differs between the committed list and a fresh collection. */
export function imageCodeStepsDrift({
  committed,
  collected,
}: {
  committed: readonly ManifestStep[];
  collected: readonly ManifestStep[];
}): string[] {
  const before = new Map(committed.map((step) => [step.id, step]));
  const after = new Map(collected.map((step) => [step.id, step]));
  const lines: string[] = [];
  for (const step of collected) {
    const old = before.get(step.id);
    if (!old) lines.push(`added: ${step.id} (${step.mode} ${step.kind})`);
    else if (JSON.stringify(old) !== JSON.stringify(step)) lines.push(`changed: ${step.id}`);
  }
  for (const step of committed) {
    if (!after.has(step.id)) lines.push(`removed: ${step.id}`);
  }
  const sameIds = lines.length === 0;
  const order = (steps: readonly ManifestStep[]) => steps.map((step) => step.id).join(",");
  if (sameIds && order(committed) !== order(collected)) lines.push("reordered: installation order");
  return lines;
}
