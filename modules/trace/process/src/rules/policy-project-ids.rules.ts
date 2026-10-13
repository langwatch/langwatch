import type { Authorization } from "@langwatch/authorization";

/**
 * The projects whose privacy policies govern a read (ADR-177 decision 9): the
 * own project first, then every project the proof reads through a shared
 * grant. A proof minted for another project says nothing about this read.
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
