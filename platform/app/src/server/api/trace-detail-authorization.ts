import { type Authorization, narrowAuthorization } from "@langwatch/actor";
import { z } from "zod";
import { getApp } from "~/server/app-layer/app";
import { TraceNotFoundError } from "~/server/app-layer/traces/errors";
import { requireRouteAuthorization } from "./authorization";

/**
 * Reusable Zod fields for the per-trace detail reads. Spread into a
 * procedure's input shape with `...`. Shared by the v2 trace router and the
 * v1 evaluation reads the drawer still calls, so the drawer sends one set of
 * arguments to both.
 */
export const spanReadHintShape = {
  /**
   * Approximate trace timestamp (ms since epoch) used as a partition-
   * pruning hint on `stored_spans`. Supplying it narrows the scan from
   * every weekly partition (incl. cold S3) down to a ±2-day window.
   * Optional — missing/invalid values fall back to the unconstrained
   * scan path on the server.
   */
  occurredAtMs: z.number().int().optional(),
  /**
   * The project that owns the trace, as the list row or the header named it
   * (ADR-144 block F). Optional: a plain project's reads never need it, and
   * an aggregate's reads fall back to the member the summary read finds.
   */
  tenantId: z.string().min(1).optional(),
} as const;

export function occurredAtFromInput(input: {
  occurredAtMs?: number;
}): { occurredAtMs: number } | Record<string, never> {
  return input.occurredAtMs !== undefined
    ? { occurredAtMs: input.occurredAtMs }
    : {};
}

type RouteContext = Parameters<typeof requireRouteAuthorization>[0];

/**
 * The proof one trace's detail reads are fenced by: the route's own, narrowed
 * on an aggregate to the member that holds the trace (ADR-144 block F), so
 * the spans, evaluations and events behind one drawer all come from the same
 * member. A named member the proof does not read is answered as not found,
 * the same answer a trace outside the proof gets.
 */
export async function traceDetailAuthorization({
  ctx,
  input,
}: {
  ctx: RouteContext;
  input: { traceId: string; occurredAtMs?: number; tenantId?: string };
}): Promise<Authorization> {
  const authorization = await getApp().traces.summary.authorizationForTrace({
    authorization: requireRouteAuthorization(ctx),
    traceId: input.traceId,
    ...occurredAtFromInput(input),
    ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
  });
  if (!authorization) throw new TraceNotFoundError(input.traceId);
  return authorization;
}

/**
 * The route's proof, narrowed to the member a caller named, for a read that
 * picks the member itself when none is named (the header's summary read, a
 * conversation's turns, one evaluation's inputs). A member outside the proof
 * is refused with the not-found error the read names.
 */
export function namedTenantAuthorization({
  ctx,
  tenantId,
  notFound,
}: {
  ctx: RouteContext;
  tenantId?: string;
  notFound: () => Error;
}): Authorization {
  const authorization = requireRouteAuthorization(ctx);
  if (tenantId === undefined) return authorization;
  const narrowed = narrowAuthorization({ authorization, projectId: tenantId });
  if (!narrowed) throw notFound();
  return narrowed;
}
