import type { Actor } from "@langwatch/actor";
import type { AuthzDeclaredScopeId } from "@langwatch/authz-contract";

/** Trusted arguments handed to a governed feature handler after policy runs. */
export type ApiHandlerArguments<Input, App> = Readonly<{
  readonly input: Input;
  readonly app: App;
  readonly actor: Actor | null;
  readonly scope: AuthzDeclaredScopeId | null;
  readonly signal: AbortSignal | undefined;
}>;
