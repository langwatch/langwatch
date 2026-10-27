/**
 * The adoption numbers `main.ts` collects at build time, as the preview reads
 * them. Undefined under vitest and wherever git was unavailable to the build.
 */
import type { Adoption } from "./adoption.ts";

const raw: unknown = import.meta.env.STORYBOOK_DESIGN_SYSTEM_ADOPTION;

export const adoption: Adoption | undefined =
  typeof raw === "string" && raw !== "" ? (JSON.parse(raw) as Adoption) : undefined;

/** The entry points a story file documents, most imported first. */
export function entriesForStory({ fileName }: { fileName: string }) {
  const story = `./${fileName.replace(/^\.\//, "")}`;
  return Object.entries(adoption?.entries ?? {})
    .filter(([, entry]) => entry.story === story)
    .toSorted((a, b) => b[1].files - a[1].files);
}
