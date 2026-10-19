/** Thrown when a name the user typed matches nothing, or more than one thing. */
export class ReferenceNotResolvedError extends Error {
  constructor(
    message: string,
    /** "none" is a missing thing; "ambiguous" is an input the caller must sharpen. */
    readonly reason: "none" | "ambiguous",
  ) {
    super(message);
  }
}

/**
 * The one row a reference names: its id, then its slug, then its name, case
 * insensitive. Two rows sharing a name is a refusal that lists their ids,
 * never a guess.
 */
export const pickByReference = <Row extends { id: string; slug: string; name: string }>({
  rows,
  reference,
  what,
  scope,
  listCommand,
}: {
  rows: readonly Row[];
  reference: string;
  /** What the rows are, singular: "project", "evaluator". */
  what: string;
  /** Where the reference was looked up: "organization", "project". */
  scope: string;
  /** The command that lists the rows, quoted in the not-found message. */
  listCommand: string;
}): Row => {
  const byId = rows.find((row) => row.id === reference);
  if (byId) return byId;
  const bySlug = rows.find((row) => row.slug === reference);
  if (bySlug) return bySlug;
  const byName = rows.filter((row) => row.name.toLowerCase() === reference.toLowerCase());
  if (byName.length === 1) return byName[0]!;
  if (byName.length > 1) {
    throw new ReferenceNotResolvedError(
      `More than one ${what} is named "${reference}" (${byName.map((row) => row.id).join(", ")}). Pass the id instead.`,
      "ambiguous",
    );
  }
  throw new ReferenceNotResolvedError(
    `No ${what} with the id, slug or name "${reference}" in this ${scope}. List them with \`${listCommand}\`.`,
    "none",
  );
};
