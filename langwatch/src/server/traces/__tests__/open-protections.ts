import type { Protections } from "~/server/elasticsearch/protections";

/**
 * Permissive protections that allow all content categories to be visible, so the
 * read mappers never redact IO values out from under the assertions in the
 * ClickHouse trace read-path tests.
 */
export const openProtections: Protections = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};
