import { verifyUnsubscribeToken } from "./unsubscribeToken";

/**
 * ADR-031: orchestration for the public `/unsubscribe` route. Kept transport-
 * agnostic (no tRPC, no prisma directly) so it unit-tests against injected
 * lookups and so the page and the one-click POST endpoint share one code path.
 */

export type UnsubscribeScope = "trigger" | "project";

export interface UnsubscribeView {
  projectName: string;
  /** Null when the link is project-wide (token's triggerId is null). */
  triggerName: string | null;
  /** Masked for display — the page never echoes the full recipient address. */
  email: string;
}

/** `alice@example.com` → `a***@example.com`. Fixed three-star mask so the
 *  rendered string never leaks the local-part length. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

export interface ResolveDeps {
  lookupNames: (params: {
    projectId: string;
    triggerId: string | null;
  }) => Promise<{ projectName: string; triggerName: string | null } | null>;
}

export async function resolveUnsubscribe({
  token,
  deps,
}: {
  token: string;
  deps: ResolveDeps;
}): Promise<UnsubscribeView | null> {
  const payload = verifyUnsubscribeToken(token);
  if (!payload) return null;

  const names = await deps.lookupNames({
    projectId: payload.projectId,
    triggerId: payload.triggerId,
  });
  if (!names) return null;

  return {
    projectName: names.projectName,
    triggerName: names.triggerName,
    email: maskEmail(payload.email),
  };
}

export interface ConfirmDeps {
  suppress: (params: {
    projectId: string;
    email: string;
    triggerId: string | null;
  }) => Promise<unknown>;
}

export async function confirmUnsubscribe({
  token,
  scope,
  deps,
}: {
  token: string;
  scope: UnsubscribeScope;
  deps: ConfirmDeps;
}): Promise<void> {
  const payload = verifyUnsubscribeToken(token);
  if (!payload) {
    throw new Error("Invalid or tampered unsubscribe token");
  }
  await deps.suppress({
    projectId: payload.projectId,
    email: payload.email,
    triggerId: scope === "project" ? null : payload.triggerId,
  });
}
