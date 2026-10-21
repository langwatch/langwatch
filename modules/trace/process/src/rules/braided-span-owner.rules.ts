import { type Authorization, isSpanBraidGrant, ownProjectIdReadBy } from "@langwatch/authorization";

/** Whether a proof reads any owner's spans through a braid (ADR-183 §5). */
export function readsBraidedSpans(authorization: Authorization): boolean {
  return authorization.grants.some(isSpanBraidGrant);
}

/** The owner a span row names, set only when it is not the reader's own (ADR-183 §5). */
export function braidedOwnerOf({
  authorization,
  tenantId,
}: {
  authorization: Authorization;
  tenantId: string | undefined;
}): { ownerProjectId: string } | Record<string, never> {
  if (tenantId === undefined || tenantId === "") return {};
  return tenantId === ownProjectIdReadBy(authorization) ? {} : { ownerProjectId: tenantId };
}
