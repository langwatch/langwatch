import { type Authorization, isSpanBraidGrant } from "@langwatch/authorization";

/**
 * A legacy read names its project beside the proof, but the proof decides which tenant is read.
 * The project is granted only when a grant of the proof reads it (a braid alone does not) and the
 * proof is not narrowed to another, so the input can never pick a tenant the proof did not.
 */
export function proofGrantsProject({
  authorization,
  projectId,
}: {
  authorization: Authorization;
  projectId: string;
}): boolean {
  const granted = authorization.grants.some(
    (grant) => grant.projectId === projectId && !isSpanBraidGrant(grant),
  );
  const narrowedElsewhere =
    authorization.narrowedTo !== undefined && authorization.narrowedTo !== projectId;
  return granted && !narrowedElsewhere;
}
