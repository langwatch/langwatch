import {
  StaffAccessExpiredError,
  StaffAccessIpMismatchError,
  StaffAccessOperatorLostError,
  StaffAccessRevokedError,
} from "@langwatch/api";
import type { PlatformDecision } from "@langwatch/api/access";
import type { RestCaller, RestIdentity } from "@langwatch/api/hosting";
import { ClientAddress } from "@langwatch/api/policy";
import type { PlatformTierPermission } from "@langwatch/authorization";
import type { StaffAccessScope } from "@langwatch/authz-contract";
import type { OpsApi } from "@langwatch/ops-contract";
import {
  STAFF_ACCESS_OPS_TOKEN_PREFIX,
  StaffAccessCredentialRefusedError,
  staffAccessDoorSessionSchema,
  staffAccessScopeSchema,
  type StaffAccessDoorSession,
} from "@langwatch/staff-access-contract";
import type { Instant } from "@langwatch/time";
import { z } from "zod";

import { hasPassed, parseToken, secretMatches } from "../rules/staff-access.rules.ts";
import type { StaffAccessAvailabilityService } from "./staff-access-availability.service.ts";
import type { StaffAccessRequesterService } from "./staff-access-requester.service.ts";
import type { StaffAccessSessionService } from "./staff-access-session.service.ts";

type DoorDeps = Readonly<{
  availability: StaffAccessAvailabilityService;
  requesters: Pick<StaffAccessRequesterService, "verify">;
  sessions: Pick<StaffAccessSessionService, "findByOpsTokenLookupId">;
  ops: Pick<OpsApi, "listPlatformOperators">;
  now: () => Instant;
}>;

/**
 * The `staff_access` door (ADR-193). It reads the bearer itself: an `lwsr_` requester key stands
 * for an enrolled agent, an `lwsa_` ops token for one live redeemed session pinned to its
 * address. It answers `opsRead:view` and `opsCopy:create` from that session's scopes, nothing else.
 */
export class StaffAccessDoorService implements RestIdentity {
  private constructor(private readonly deps: DoorDeps) {}

  static create(deps: DoorDeps): StaffAccessDoorService {
    return new StaffAccessDoorService(deps);
  }

  authenticate(): never {
    throw new StaffAccessCredentialRefusedError();
  }

  async identify({ request }: { request: Request }): Promise<RestCaller> {
    await this.deps.availability.assertOpen();
    const token = presentedBearer(request.headers.get("authorization"));
    const ipAddress = ClientAddress.resolvedFor(request) ?? null;
    const userAgent = request.headers.get("user-agent");
    const session = token.startsWith(STAFF_ACCESS_OPS_TOKEN_PREFIX)
      ? await this.opsSessionOf({ token, ipAddress, userAgent })
      : await this.requesterSessionOf({ token, ipAddress, userAgent });
    return { actor: null, scope: null, session };
  }

  authorizePlatform({
    caller,
    permission,
  }: {
    caller: RestCaller;
    permission: PlatformTierPermission;
  }): PlatformDecision {
    const parsed = staffAccessDoorSessionSchema.safeParse(caller.session);
    if (!parsed.success || parsed.data.kind !== "ops") return { permitted: false };
    const answeredBy = DOOR_PERMISSION_SCOPES[permission];
    return { permitted: answeredBy !== undefined && parsed.data.scopes.includes(answeredBy) };
  }

  private async requesterSessionOf({
    token,
    ipAddress,
    userAgent,
  }: {
    token: string;
    ipAddress: string | null;
    userAgent: string | null;
  }): Promise<StaffAccessDoorSession> {
    const requester = await this.deps.requesters.verify({ token });
    return {
      kind: "requester",
      requesterId: requester.id,
      ownerUserId: requester.ownerUserId,
      ipAddress,
      userAgent,
    };
  }

  private async opsSessionOf({
    token,
    ipAddress,
    userAgent,
  }: {
    token: string;
    ipAddress: string | null;
    userAgent: string | null;
  }): Promise<StaffAccessDoorSession> {
    const parsed = parseToken({ token, prefix: STAFF_ACCESS_OPS_TOKEN_PREFIX });
    if (!parsed) throw new StaffAccessCredentialRefusedError();
    const [session] = await this.deps.sessions.findByOpsTokenLookupId({
      lookupId: parsed.lookupId,
    });
    if (
      !session?.hashedOpsToken ||
      !secretMatches({ secret: parsed.secret, hashed: session.hashedOpsToken })
    ) {
      throw new StaffAccessCredentialRefusedError();
    }
    if (session.revokedAt !== null || session.status !== "redeemed") {
      throw new StaffAccessRevokedError();
    }
    if (
      session.accessExpiresAt === null ||
      hasPassed({ moment: session.accessExpiresAt, at: this.deps.now() })
    ) {
      throw new StaffAccessExpiredError();
    }
    if (session.pinnedIp !== ipAddress) throw new StaffAccessIpMismatchError();
    const operators = await this.deps.ops.listPlatformOperators();
    if (!operators.some((operator) => operator.userId === session.ownerUserId)) {
      throw new StaffAccessOperatorLostError();
    }
    return {
      kind: "ops",
      requestId: session.id,
      scopes: staffAccessDoorSessionScopes(session.scopes),
      ipAddress,
      userAgent,
    };
  }
}

/** The only platform permissions this door answers, each from one approved scope. */
const DOOR_PERMISSION_SCOPES: Partial<Record<PlatformTierPermission, StaffAccessScope>> = {
  "opsRead:view": "ops:read",
  "opsCopy:create": "copy:target",
};

/** RFC 6750: the Bearer scheme in any case, then the token; anything else presents "". */
function presentedBearer(header: string | null): string {
  return /^Bearer\s+(.+)$/i.exec(header?.trim() ?? "")?.[1]?.trim() ?? "";
}

function staffAccessDoorSessionScopes(scopes: readonly string[]): StaffAccessScope[] {
  const parsed = z.array(staffAccessScopeSchema).safeParse(scopes);
  if (!parsed.success) throw new StaffAccessRevokedError();
  return parsed.data;
}
