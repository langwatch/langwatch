/** §4.1 of the internal door: a raw virtual key or license token resolved to a signed JWT. */
import type { RestDeclaredResult } from "@langwatch/api/rest";
import {
  type gatewayInternalResolveKeyAnswers,
  gatewayInternalResolveKeySchema,
  type GatewayInternalProtocol,
  type GatewayLicenseTokenRefusal,
  type GatewayVirtualKeyRecord,
  LICENSE_TOKEN_PREFIX,
} from "@langwatch/gateway-contract";
import { nowInstant, type Instant } from "@langwatch/time";

import {
  VirtualKeyCryptoError,
  VirtualKeyCryptoService,
} from "../features/virtual-key/services/virtual-key-crypto.service.ts";
import {
  answer,
  detectVirtualKeyStatusRejection,
  readJson,
  refuse,
  type KeyAuthRejection,
} from "../rules/gateway-internal-door.rules.ts";
import type { GatewayAuthDecisionService } from "./gateway-auth-decision.service.ts";

/** How each license-token refusal reads on the wire, exactly as main answered it. */
const LICENSE_TOKEN_REFUSALS: Record<
  GatewayLicenseTokenRefusal,
  { status: 400 | 401 | 403; message: string }
> = {
  connect_license_token_malformed: { status: 401, message: "the license token is malformed" },
  connect_instance_required: {
    status: 400,
    message: "a license token must be presented with an instance id",
  },
  connect_license_not_registered: {
    status: 401,
    message: "this license is not registered for hosted services",
  },
  connect_license_revoked: { status: 403, message: "this license is no longer active" },
  connect_license_expired: { status: 403, message: "this license has expired" },
  connect_wrong_instance: { status: 403, message: "this license is bound to another instance" },
};

/**
 * Why the presented key does not parse, or null when it does. Anything that is
 * not a VirtualKeyCryptoError is a bug rather than a bad credential, so it rethrows.
 */
function detectVirtualKeyParseRejection(presented: string): KeyAuthRejection | null {
  try {
    VirtualKeyCryptoService.parseSecret(presented);
    return null;
  } catch (err) {
    if (!(err instanceof VirtualKeyCryptoError)) throw err;
    return { status: 401, type: "invalid_api_key", code: err.code, message: err.message };
  }
}

type ResolveKeyAnswer = RestDeclaredResult<typeof gatewayInternalResolveKeyAnswers>;

export class GatewayInternalKeyResolutionService {
  static create({
    protocol,
    authDecisions,
  }: {
    protocol: GatewayInternalProtocol;
    authDecisions: GatewayAuthDecisionService;
  }): GatewayInternalKeyResolutionService {
    return new GatewayInternalKeyResolutionService(protocol, authDecisions);
  }

  private constructor(
    private readonly protocol: GatewayInternalProtocol,
    private readonly authDecisions: GatewayAuthDecisionService,
  ) {}

  /** §4.1: a raw virtual key or license token, resolved to a signed JWT and its revision. */
  async answerResolveKey({
    raw,
    node,
  }: {
    raw: string;
    node: string | undefined;
  }): Promise<ResolveKeyAnswer> {
    const presented = gatewayInternalResolveKeySchema.safeParse(readJson(raw) ?? {});
    if (!presented.success) {
      return refuse(400, {
        type: "bad_request",
        code: "missing_key_presented",
        message: "key_presented is required",
      });
    }
    const { key_presented: keyPresented, instance_id: instanceId } = presented.data;
    if (keyPresented.startsWith(LICENSE_TOKEN_PREFIX)) {
      return this.resolveLicenseToken({ token: keyPresented, instanceId, node });
    }
    return this.resolveVirtualKey({ presented: keyPresented, node });
  }

  private async resolveLicenseToken({
    token,
    instanceId,
    node,
  }: {
    token: string;
    instanceId: string | undefined;
    node: string | undefined;
  }): Promise<ResolveKeyAnswer> {
    const resolution = await this.protocol.resolveLicenseToken({ token, instanceId });
    if (!resolution.ok) {
      const refusal = LICENSE_TOKEN_REFUSALS[resolution.code];
      this.authDecisions.record({ request: node, code: resolution.code, status: refusal.status });
      return refuse(refusal.status, {
        type: resolution.code,
        code: resolution.code,
        message: refusal.message,
      });
    }
    return answer(
      await this.keyResolution({
        vk: resolution.key,
        notAfter: resolution.notAfter ?? null,
        connectServices: resolution.connectServices,
      }),
    );
  }

  private async resolveVirtualKey({
    presented,
    node,
  }: {
    presented: string;
    node: string | undefined;
  }): Promise<ResolveKeyAnswer> {
    const parseRejection = detectVirtualKeyParseRejection(presented);
    if (parseRejection) {
      this.authDecisions.record({
        request: node,
        code: parseRejection.code,
        status: parseRejection.status,
      });
      return refuse(parseRejection.status, { ...parseRejection });
    }

    const vk = await this.protocol.findVirtualKeyBySecret(presented);
    if (!vk) {
      this.authDecisions.record({ request: node, code: "virtual_key_not_found", status: 401 });
      return refuse(401, {
        type: "invalid_api_key",
        code: "virtual_key_not_found",
        message: "unknown virtual key",
      });
    }

    const statusRejection = detectVirtualKeyStatusRejection({
      status: vk.status,
      expiresAt: vk.expiresAt,
      now: nowInstant(),
    });
    if (statusRejection) {
      this.authDecisions.record({
        request: node,
        code: statusRejection.code,
        status: statusRejection.status,
        detail: { vkId: vk.id },
      });
      return refuse(statusRejection.status, { ...statusRejection });
    }

    return answer(await this.keyResolution({ vk, notAfter: vk.expiresAt }));
  }

  /**
   * Signs for a key that may serve. `notAfter` ends the token at the key's (or the
   * license's) end when that comes before the 15 minute TTL, so an auth cache never
   * outlives the key; a license's services travel as the `connect_services` claim.
   */
  private async keyResolution({
    vk,
    notAfter,
    connectServices,
  }: {
    vk: GatewayVirtualKeyRecord;
    notAfter: Instant | null;
    connectServices?: string[];
  }) {
    // Null for a key written before the destination was stored, in an organization
    // with no governance project: the gateway then skips span export instead.
    const traceProject = vk.traceProjectId
      ? await this.protocol.findTraceDestination(vk.traceProjectId)
      : null;
    const { jwt } = this.protocol.signJwt({
      vk_id: vk.id,
      project_id: traceProject?.id ?? null,
      team_id: traceProject?.teamId ?? null,
      org_id: vk.organizationId,
      principal_id: vk.principalUserId,
      revision: vk.revision.toString(),
      notAfter,
      ...(connectServices ? { connect_services: connectServices } : {}),
    });
    // Fire-and-forget last-used bump. Failures here must not deny the request.
    void this.protocol.touchVirtualKeyUsage(vk.id).catch(() => void 0);

    return {
      jwt,
      revision: vk.revision.toString(),
      key_id: vk.id,
      display_prefix: vk.displayPrefix,
    };
  }
}
