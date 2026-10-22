import { type Authorization, isSpanBraidGrant } from "@langwatch/authorization";

/**
 * The projects whose privacy policies govern a read (ADR-177 decision 9): the own project, then
 * every project read through a shared grant. A braid's owner is left out: its spans carry its own
 * policy and never govern the reader's (ADR-183 §5). A proof minted elsewhere says nothing.
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
        grant.projectId === undefined || isSpanBraidGrant(grant) ? [] : [grant.projectId],
      ),
    ]),
  ];
}
