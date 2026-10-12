import { type Authorization, internalActor } from "@langwatch/actor";
import { getApp } from "~/server/app-layer/app";

/**
 * The proof a procedure's `.permission()` mint left on the context, for a
 * read that applies it (ADR-144 block C). A procedure that reaches such a
 * read without the mint is a programming error, not a customer's, so it
 * fails as a plain error with the trace id rather than a handled one.
 */
export function requireRouteAuthorization(ctx: {
  authorization?: Authorization;
}): Authorization {
  if (!ctx.authorization) {
    throw new Error(
      "procedure reached a proof-bearing read without a .permission() mint",
    );
  }
  return ctx.authorization;
}

/**
 * The own-only proof for a route whose caller was admitted some other way,
 * an API key, a share link or an annotation permission, before it reads
 * traces (ADR-144 block C). It fences the read to `projectId` alone and
 * widens through no grant, so an aggregate id reads its own empty tenant.
 * `codePath` names the route module for the internal actor.
 */
export function ownOnlyTraceReadAuthorization({
  codePath,
  projectId,
  route,
}: {
  codePath: string;
  projectId: string;
  route: string;
}): Promise<Authorization> {
  return getApp().authorization.authorizeInternal({
    actor: internalActor(codePath),
    projectId,
    permission: "traces:view",
    purpose: { kind: "route", route },
  });
}
