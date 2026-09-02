/**
 * What one saved version of a test case says about itself.
 *
 * @see specs/features/agent-testing/case-version-history.feature
 * @see specs/scenarios/scenario-versioning.feature
 */

export type VersionEntry = {
  version: number;
  authorId: string | null;
  authorLabel: string | null;
  authorName?: string | null;
  changeDescription: string | null;
  changedFields: string[];
  createdAt: Date | string;
  isSynthesized: boolean;
};

/** Who saved a version, in the words the reader knows the writer by. */
export function authorOf(entry: VersionEntry): string | null {
  if (entry.authorLabel === "langy") return "Langy";
  if (entry.authorLabel === "api") return "API";
  if (entry.authorLabel === "cli") return "CLI";
  if (entry.authorLabel === "user") return entry.authorName ?? "You";
  return null;
}

/**
 * What one entry says changed.
 *
 * A version that carries its own description says that: a restore writes the
 * old content forward, so its field list reads like an ordinary edit and
 * would not say where the content came from.
 */
export function changeLineOf(entry: VersionEntry): string {
  if (entry.changeDescription) return entry.changeDescription;
  if (entry.changedFields.length > 0) {
    return `changed ${entry.changedFields.join(", ")}`;
  }
  return "Created";
}
