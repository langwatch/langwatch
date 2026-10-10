import type { Actor, Authorization, AuthzDeclaredScopeId } from "@langwatch/authorization";

/** Trusted arguments handed to a governed feature handler after policy runs. */
export type ApiHandlerArguments<Input, App> = Readonly<{
  readonly input: Input;
  readonly app: App;
  readonly actor: Actor | null;
  readonly scope: AuthzDeclaredScopeId | null;
  /** The sealed proof a proof-bearing project read carries to its store (ADR-166); else null. */
  readonly authorization: Authorization | null;
  readonly signal: AbortSignal | undefined;
}>;
