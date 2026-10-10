import type { Authorization } from "@langwatch/actor";

/**
 * The projects whose privacy policies govern a read (ADR-144 decision 9).
 *
 * The proof is what the read actually sees, so the policies come from its
 * grants: the own project first, then every project it reads through a
 * shared grant. A plain project's proof holds only its own grant and reads
 * as before. A proof narrowed to one member holds the own grant and that
 * member's, so a detail page opened from an aggregate applies the stricter
 * of the aggregate's policy and its member's, not every member's.
 *
 * A proof minted for some other project than the one shown says nothing
 * about this read, so it is ignored rather than trusted.
 */
export function policyProjectIdsOf({
  projectId,
  authorization,
}: {
  projectId: string;
  authorization?: Authorization;
}): string[] {
  if (!authorization) return [projectId];
  const own = authorization.grants.find((grant) => grant.kind === "own");
  if (own?.projectId !== projectId) return [projectId];
  return [
    ...new Set([
      projectId,
      ...authorization.grants.flatMap((grant) =>
        grant.projectId === undefined ? [] : [grant.projectId],
      ),
    ]),
  ];
}
