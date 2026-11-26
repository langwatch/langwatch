import type { Authorization } from "@langwatch/authorization";

export type TracesFence =
  | { kind: "refused" }
  | { kind: "fenced"; admits: (row: { tenantId: string; atMs: number }) => boolean };

/**
 * Whether a row of `tenantId` at `atMs` is inside a proof's `traces:view` fence, as the
 * clickhouse client's `fenceFor` reads it: own projects outright, shared ones inside their
 * grant's window. Refused when the proof has no own grant or its narrowing matches nothing.
 */
export function tracesFenceOf(authorization: Authorization): TracesFence {
  const carrying = authorization.grants.filter((grant) =>
    grant.permissions.includes("traces:view"),
  );
  if (!carrying.some((grant) => grant.kind === "own")) return { kind: "refused" };
  const grants = carrying.filter(
    (grant) =>
      authorization.narrowedTo === undefined || grant.projectId === authorization.narrowedTo,
  );
  if (grants.length === 0) return { kind: "refused" };

  const admits = ({ tenantId, atMs }: { tenantId: string; atMs: number }): boolean =>
    grants.some((grant) => {
      if (grant.projectId !== tenantId) return false;
      if (grant.kind === "own") return true;
      const window = grant.condition;
      return (
        window?.type === "trace" &&
        atMs >= (window.from ?? 0) &&
        (window.until === null || window.until === undefined || atMs < window.until)
      );
    });
  return { kind: "fenced", admits };
}
