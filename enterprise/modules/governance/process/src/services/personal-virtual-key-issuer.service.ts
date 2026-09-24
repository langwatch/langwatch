// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Personal keys are minted and revoked through the gateway's own virtual
 * keys — a peer-module call, not state this module owns.
 */
import type { PersonalVirtualKey } from "@langwatch/enterprise-governance-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";

import type { PersonalVirtualKeyIssuer } from "../app/governance.members.ts";
import { toPersonalVirtualKey } from "../rules/personal-virtual-key.rules.ts";

/** The two gateway operations this service needs, out of `GatewayApi`'s whole surface. */
type PersonalVirtualKeyGateway = Pick<GatewayApi, "createVirtualKey" | "revokeVirtualKey">;

/** One issued personal virtual key, on the shape `PersonalVirtualKeyIssuer` answers. */
export class GatewayPersonalVirtualKeyIssuerService implements PersonalVirtualKeyIssuer {
  private constructor(private readonly gateway: PersonalVirtualKeyGateway) {}

  static create(gateway: PersonalVirtualKeyGateway): GatewayPersonalVirtualKeyIssuerService {
    return new GatewayPersonalVirtualKeyIssuerService(gateway);
  }

  async issue(input: {
    organizationId: string;
    userId: string;
    personalProjectId: string;
    label: string;
    routingPolicyId: string | null;
  }): Promise<{ virtualKey: PersonalVirtualKey; secret: string }> {
    const issued = await this.gateway.createVirtualKey({
      organizationId: input.organizationId,
      name: input.label,
      description: "Personal virtual key",
      principalUserId: input.userId,
      scopes: [{ scopeType: "PROJECT", scopeId: input.personalProjectId }],
      routingPolicyId: input.routingPolicyId,
      actorUserId: input.userId,
    });
    return {
      virtualKey: toPersonalVirtualKey(issued.virtualKey),
      secret: issued.secret,
    };
  }

  async revoke(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<PersonalVirtualKey> {
    return toPersonalVirtualKey(await this.gateway.revokeVirtualKey(input));
  }
}
