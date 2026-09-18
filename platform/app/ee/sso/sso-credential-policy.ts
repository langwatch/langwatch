// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { SignInRouterService } from "@langwatch/identity-server";

import type { SsoBreakGlassService } from "./break-glass.service";
import type { SsoConnectionReadRepository } from "./sso-connection.repository";

interface SsoCredentialPolicyDeps {
  router: SignInRouterService;
  connections: SsoConnectionReadRepository;
  breakGlass: SsoBreakGlassService;
}

/** Authorizes an already proved password against its address's current route. */
export class SsoCredentialPolicy {
  readonly #deps: SsoCredentialPolicyDeps;

  private constructor(deps: SsoCredentialPolicyDeps) {
    this.#deps = deps;
  }

  static create(deps: SsoCredentialPolicyDeps): SsoCredentialPolicy {
    return new SsoCredentialPolicy(deps);
  }

  async canSignIn({
    userId,
    email,
  }: {
    userId: string;
    email: string;
  }): Promise<boolean> {
    const decision = await this.#deps.router.route({ identifier: email });
    if (decision.outcome !== "redirect_to_connection") return true;

    const connectionId = decision.methodSet.find(
      (method) => method.connectionId !== null,
    )?.connectionId;
    // Instance federation is governed by the deployment's request hook.
    // Only an organization's connection can require its recovery grant here.
    if (!connectionId) return true;
    const connection = await this.#deps.connections.findConnection({
      connectionId,
    });
    if (connection === null) return false;

    // Eligibility is checked when granting; a later role change does not
    // revoke the holder's existing recovery door.
    const bindings = await this.#deps.breakGlass.live({
      organizationId: connection.organizationId,
    });
    return bindings.some((binding) => binding.userId === userId);
  }
}
