/**
 * The authz feature's application: what its door calls.
 *
 * It holds the service the feature's api file reaches, and it is the one typed
 * thing a transport is given. Before it, `authz.api.ts` declared its own
 * private `Readonly<{ permissions: AuthzService }>` — a description of the
 * process's composition that agreed with the process by attention rather than
 * by construction.
 *
 * What lives here as a method is the one question this feature answers: "what
 * may I do here". Resolving which scope "here" means — a project id names a
 * project scope even when an organization id rides along — is a decision about
 * the domain, not about transport, so it is here and not in a handler.
 *
 * A caller arrives as an argument, never read from a session or a request.
 * That is what lets one operation serve a browser session, an API key and a
 * background job without knowing which it is serving.
 */
import type {
  AuthzEffectivePermissionsOutput,
  AuthzScopeRef,
  AuthzService,
} from "@langwatch/authz-contract";

/** Whose standing is being resolved. */
export interface AuthzCaller {
  readonly id: string;
}

/** What the process composes this feature's application from. */
export interface AuthzAppDependencies {
  permissions: AuthzService;
}

/**
 * The caller's own standing at one scope. A scope they have no standing in —
 * or one that does not resolve at all — answers the empty set rather than
 * anything about the scope itself.
 */
export type EffectivePermissions =
  | Readonly<{ scope: null; permissions: string[] }>
  | Readonly<{
      scope: Readonly<{ type: AuthzScopeRef["type"]; id: string }>;
      permissions: AuthzEffectivePermissionsOutput;
    }>;

export class AuthzApp {
  static create(dependencies: AuthzAppDependencies): AuthzApp {
    return new AuthzApp(dependencies);
  }

  private constructor(private readonly dependencies: AuthzAppDependencies) {}

  /**
   * What the caller may do at the scope they named.
   *
   * It never answers for another principal, so membership itself is the only
   * requirement: a non-member resolves to the empty set, which is the engine's
   * no-default-access answering rather than a special case here.
   */
  async effectivePermissionsFor(
    input: Readonly<{ projectId?: string | undefined; organizationId?: string | undefined }>,
    by: AuthzCaller,
  ): Promise<EffectivePermissions> {
    // The narrower id wins: a project id names a project scope even when an
    // organization id rides along.
    const scope = await this.dependencies.permissions.tryResolveScope({
      projectId: input.projectId,
      organizationId: input.projectId ? undefined : input.organizationId,
    });
    if (!scope) return { scope: null, permissions: [] };

    const permissions = await this.dependencies.permissions.effectivePermissions({
      principal: { type: "user", id: by.id },
      scope,
    });

    return { scope: { type: scope.type, id: scope.id }, permissions };
  }
}
