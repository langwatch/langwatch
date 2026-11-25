// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** Personal keys are minted and revoked as gateway virtual keys, through `GatewayApi`. */
import type { PersonalVirtualKey } from "@langwatch/enterprise-gateway-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";

import { toPersonalVirtualKey } from "../rules/personal-virtual-key.rules.ts";

type PersonalVirtualKeyGateway = Pick<GatewayApi, "createVirtualKey" | "revokeVirtualKey">;

export class PersonalVirtualKeyIssuerService {
  private constructor(private readonly gateway: PersonalVirtualKeyGateway) {}

  static create(gateway: PersonalVirtualKeyGateway): PersonalVirtualKeyIssuerService {
    return new PersonalVirtualKeyIssuerService(gateway);
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
