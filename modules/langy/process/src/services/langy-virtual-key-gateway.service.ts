import type { GatewayApi } from "@langwatch/gateway-contract";
import { LANGY_VK_SECRET_NAME, type SecretApi } from "@langwatch/secret-contract";

import type { LangyVirtualKeyService } from "./langy-credential.service.ts";

const LANGY_VK_DISPLAY_NAME = "Langy";
const LANGY_VK_DESCRIPTION = "Auto-provisioned virtual key for the Langy in-product assistant.";

export interface LangyVirtualKeyGatewayServiceOptions {
  secrets: Pick<SecretApi, "getValues" | "createReserved">;
  gateway: Pick<GatewayApi, "createVirtualKey">;
}

/**
 * One gateway key per project, stored under the reserved secret name and minted on first need.
 * A key minted by the loser of a race stays an orphan, as on main.
 */
export class LangyVirtualKeyGatewayService implements LangyVirtualKeyService {
  private constructor(private readonly options: LangyVirtualKeyGatewayServiceOptions) {}

  static create(options: LangyVirtualKeyGatewayServiceOptions): LangyVirtualKeyGatewayService {
    return new LangyVirtualKeyGatewayService(options);
  }

  async provision(input: {
    projectId: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<string> {
    const stored = await this.options.secrets.getValues({ projectId: input.projectId });
    const existing = stored[LANGY_VK_SECRET_NAME];
    if (existing) return existing;

    const minted = await this.options.gateway.createVirtualKey({
      organizationId: input.organizationId,
      name: LANGY_VK_DISPLAY_NAME,
      description: LANGY_VK_DESCRIPTION,
      principalUserId: null,
      scopes: [{ scopeType: "PROJECT", scopeId: input.projectId }],
      actorUserId: input.actorUserId,
      purpose: "LANGY",
    });
    const { value } = await this.options.secrets.createReserved({
      projectId: input.projectId,
      name: LANGY_VK_SECRET_NAME,
      value: minted.secret,
      actorId: input.actorUserId,
    });

    return value;
  }
}
