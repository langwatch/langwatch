/** The read budget on tRPC: queries and exports, counted after the check resolved the caller. */
import type { Actor, AuthzDeclaredScopeId } from "@langwatch/authorization";
import type { MiddlewareResult } from "@trpc/server/unstable-core-do-not-import";

import { type ReadBudget, readKindOf, rowsOf } from "../read-budget.ts";
import { actorReadCredential } from "../read-credential.ts";

export type TrpcReadBudget<TContext> = Readonly<{
  budget: ReadBudget;
  actorOf(ctx: TContext): Actor | null;
}>;

function scopeOfInput(input: unknown): AuthzDeclaredScopeId | null {
  if (typeof input !== "object" || input === null) return null;
  const projectId = (input as { projectId?: unknown }).projectId;
  return typeof projectId === "string" ? { tier: "project", id: projectId } : null;
}

/** Absent a budget, every call passes through uncounted. */
export function trpcReadBudget<TContext>(readBudget: TrpcReadBudget<TContext> | undefined) {
  return async ({
    ctx,
    path,
    type,
    input,
    next,
  }: {
    ctx: TContext;
    path: string;
    type: string;
    input?: unknown;
    next: () => Promise<MiddlewareResult<object>>;
  }): Promise<MiddlewareResult<object>> => {
    if (!readBudget) return next();
    const kind = readKindOf({
      operation: path.split(".").at(-1) ?? path,
      method: type === "query" ? "GET" : "POST",
    });
    const credential = kind ? actorReadCredential(readBudget.actorOf(ctx)) : null;
    if (!kind || !credential) return next();

    const call = { credential, kind, route: path, scope: scopeOfInput(input) } as const;
    await readBudget.budget.admit(call);
    const result = await next();
    if (result.ok) void readBudget.budget.record({ ...call, rows: rowsOf(result.data) });
    return result;
  };
}
