// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The SCIM feature's application: what its doors call.
 *
 * Two of them mint and retire provisioning tokens — the settings page over
 * tRPC, and the management REST family an identity team scripts against — and
 * a third relays a directory's log stream. Before this, the tRPC door declared
 * `Readonly<{ scim: ScimService; planProvider: … }>` for itself while the REST
 * family took a `scim` resolver and the webhook took the service as a call
 * argument: three descriptions of one bag, none reachable from the others.
 *
 * The token operations are the service's own and are reached through it. What
 * this object adds is that they are reached through ONE thing, so a rule about
 * minting a token — which connection it binds to, what is returned once and
 * never again — has one place to live rather than three.
 *
 * The webhook relay still takes the `ScimService` directly: it walks an Auth0
 * payload into four user-provisioning calls no other door reaches, and lifting
 * those onto this object is a separate move.
 */
import type { ScimService, ScimTokenSummary } from "@langwatch/enterprise-scim-contract";

/**
 * The plan the organization is on, as the process resolves it. Structural: the
 * plan source is the process's, and this feature only ever asks whether it is
 * the Enterprise one.
 */
export type ScimPlanProvider = Readonly<{
  getActivePlan(input: { organizationId: string }): Promise<Readonly<{ type: string }>>;
}>;

/** What the process composes this feature's application from. */
export interface ScimAppDependencies {
  scim: ScimService;
  planProvider: ScimPlanProvider;
}

/** A newly minted token: the one moment its value exists outside the database. */
export interface IssuedScimToken {
  token: string;
  tokenId: string;
  connectionId: string;
}

export class ScimApp {
  static create(dependencies: ScimAppDependencies): ScimApp {
    return new ScimApp(dependencies);
  }

  private constructor(private readonly dependencies: ScimAppDependencies) {}

  /** The organization's tokens, described. Never a value or a hash. */
  listTokens(input: { organizationId: string }): Promise<ScimTokenSummary[]> {
    return this.dependencies.scim.listTokens(input);
  }

  /**
   * Mints a token for one directory connection.
   *
   * `connectionId` is the whole of the token's write authority, so it is named
   * here rather than defaulted: the service refuses a token that binds to no
   * connection, and that refusal is the one a caller can act on.
   */
  generateToken(input: {
    organizationId: string;
    connectionId?: string | null;
    description?: string;
  }): Promise<IssuedScimToken> {
    return this.dependencies.scim.generateToken(input);
  }

  /** Retires one token. Idempotent from the caller's side. */
  revokeToken(input: { organizationId: string; tokenId: string }): Promise<{ success: true }> {
    return this.dependencies.scim.revokeToken(input);
  }

  /**
   * The plan source, handed back to the process's own Enterprise gate.
   *
   * The gate is a port because whether an organization has bought Enterprise
   * is the process's answer, not SCIM's; the provider it reads is held here so
   * a door does not have to carry one of its own alongside the application.
   */
  get planProvider(): ScimPlanProvider {
    return this.dependencies.planProvider;
  }
}
