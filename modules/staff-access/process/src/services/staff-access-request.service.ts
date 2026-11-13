import { StaffAccessAuditUnavailableError } from "@langwatch/api";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type {
  AuthApi,
  PasskeyAssertionOptions,
  PasskeyAssertionResponse,
} from "@langwatch/auth-contract";
import type { StaffAccessScope } from "@langwatch/authz-contract";
import {
  namesOrganization,
  reachesOrganization,
  staffAccessPermissions,
  staffCopyGrant,
} from "@langwatch/authz-contract";
import { generate } from "@langwatch/ksuid";
import type {
  OrganizationApi,
  OrganizationProvisioningSummary,
} from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import {
  STAFF_ACCESS_OPS_TOKEN_PREFIX,
  STAFF_ACCESS_PRINCIPAL,
  StaffAccessAlreadyRedeemedError,
  StaffAccessInvalidCodeVerifierError,
  StaffAccessNotFoundError,
  StaffAccessOrganizationNameMismatchError,
  StaffAccessNotConfiguredError,
  StaffAccessRateLimitedError,
  StaffAccessRequestNotPendingError,
  StaffCopySameOrganizationError,
  type StaffAccessApprovalView,
  type StaffAccessRedeemed,
  type StaffAccessRequestBody,
  type StaffAccessRequestCreated,
  type StaffAccessRequestStatusAnswer,
  type StaffAccessSessionView,
} from "@langwatch/staff-access-contract";
import { type Instant, toDate } from "@langwatch/time";
import type { UserApi } from "@langwatch/user-contract";

import type {
  StaffAccessRequestRepository,
  StaffAccessRequestRow,
} from "../repositories/staff-access.repository.ts";
import {
  approvalChallengeOf,
  approvalFieldsOf,
  assertPending,
  assertRedeemable,
  isoText,
  later,
  mintToken,
  organizationNameMatches,
  mintsOpsToken,
  pendingRequestRow,
  pkceChallengeOf,
  shownStatus,
  STAFF_ACCESS_RATE_WINDOW_MS,
  STAFF_ACCESS_REQUESTS_PER_HOUR,
  STAFF_ACCESS_SESSION_TTL_MS,
  staffKeyKindOf,
  typedNameRequired,
} from "../rules/staff-access.rules.ts";
import type { StaffAccessNoticeService } from "./staff-access-notice.service.ts";
import type { StaffAccessRequesterService } from "./staff-access-requester.service.ts";
import type { StaffAccessSessionService } from "./staff-access-session.service.ts";

const PROJECTS_LISTED = 100;

type RequestDeps = Readonly<{
  requests: StaffAccessRequestRepository;
  requesters: StaffAccessRequesterService;
  auth: Pick<AuthApi, "hasPasskey" | "passkeyAssertionOptions" | "verifyPasskeyAssertion">;
  organizations: Pick<OrganizationApi, "findProvisioningSummary" | "listProvisioningSummaries">;
  projects: Pick<ProjectApi, "listByOrganization">;
  apiKeys: Pick<ApiKeyApi, "mintStaffAccessKey" | "revokeStaffAccessKey">;
  auditLog: Pick<AuditLogApi, "record">;
  users: Pick<UserApi, "findById">;
  notices: StaffAccessNoticeService;
  sessions: StaffAccessSessionService;
  /** Null when the deployment has none: requests are then refused, since no link can be built. */
  publicBaseUrl: string | null;
  now: () => Instant;
}>;

/** What the operator decided on the approval page. */
type Choice = Readonly<{
  requestId: string;
  spendApproved: boolean;
  typedOrganizationName?: string;
}>;

/**
 * Access requests from asking to ending (ADR-193): the agent asks, its owner approves with a
 * passkey over the hash of exactly what the page shows, the agent redeems once with its PKCE
 * verifier for one hour, and any operator can end it. Every transition is one atomic claim.
 */
export class StaffAccessRequestService {
  private constructor(private readonly deps: RequestDeps) {}

  static create(deps: RequestDeps): StaffAccessRequestService {
    return new StaffAccessRequestService(deps);
  }

  /**
   * @throws {StaffAccessRateLimitedError} past five requests in an hour
   * @throws {StaffAccessNotConfiguredError} when the deployment has no public base URL
   */
  async createRequest({
    requesterId,
    ownerUserId,
    body,
    ipAddress,
  }: {
    requesterId: string;
    ownerUserId: string;
    body: StaffAccessRequestBody;
    ipAddress: string | null;
  }): Promise<StaffAccessRequestCreated> {
    const { publicBaseUrl } = this.deps;
    if (!publicBaseUrl) throw new StaffAccessNotConfiguredError();
    const at = this.deps.now();
    const recent = await this.deps.requests.countSince({
      requesterId,
      since: later({ at, ms: -STAFF_ACCESS_RATE_WINDOW_MS }),
    });
    if (recent >= STAFF_ACCESS_REQUESTS_PER_HOUR) {
      throw new StaffAccessRateLimitedError({ retryAfterMs: STAFF_ACCESS_RATE_WINDOW_MS });
    }
    const organization = namesOrganization(body.scopes)
      ? await this.resolveOrganization({ organization: body.organization ?? "" })
      : null;
    const counterpart = body.counterpartOrganization
      ? await this.resolveOrganization({ organization: body.counterpartOrganization })
      : null;
    if (counterpart && counterpart.id === organization?.id) {
      throw new StaffCopySameOrganizationError();
    }
    const row = pendingRequestRow({
      id: generate("staffrequest").toString(),
      requesterId,
      ownerUserId,
      body,
      organization,
      counterpart,
      ipAddress,
      at,
    });
    await this.deps.requests.create(row);
    return {
      requestId: row.id,
      approvalUrl: `${publicBaseUrl.replace(/\/+$/, "")}/ops/agents/approve/${row.id}`,
      expiresAt: isoText(row.expiresAt),
    };
  }

  async getRequestStatus({
    requesterId,
    requestId,
  }: {
    requesterId: string;
    requestId: string;
  }): Promise<StaffAccessRequestStatusAnswer> {
    const row = await this.requestOfRequester({ requesterId, requestId });
    return {
      requestId: row.id,
      status: shownStatus({ ...row, at: this.deps.now() }),
      expiresAt: isoText(row.expiresAt),
      accessExpiresAt: row.accessExpiresAt ? isoText(row.accessExpiresAt) : null,
    };
  }

  async getApprovalRequest({
    userId,
    requestId,
  }: {
    userId: string;
    requestId: string;
  }): Promise<StaffAccessApprovalView> {
    return this.approvalViewOf(await this.requestOfOwner({ userId, requestId }));
  }

  /** The ceremony over the hash of what the page shows and what the operator chose. */
  async approvalOptions({
    userId,
    choice,
  }: {
    userId: string;
    choice: Choice;
  }): Promise<PasskeyAssertionOptions> {
    const { challenge } = await this.decidable({ userId, choice });
    return this.deps.auth.passkeyAssertionOptions({ userId, challenge });
  }

  /**
   * Verifies the passkey over that same hash, then claims pending -> approved, records the
   * approval in the customer's audit log and tells the other operators.
   * @throws {PasskeyAssertionRefusedError} when the signature is over anything else
   */
  async approve({
    userId,
    choice,
    assertion,
  }: {
    userId: string;
    choice: Choice;
    assertion: PasskeyAssertionResponse;
  }): Promise<StaffAccessApprovalView> {
    const { row, challenge, spendApproved } = await this.decidable({ userId, choice });
    const { credentialId } = await this.deps.auth.verifyPasskeyAssertion({
      userId,
      challenge,
      response: assertion,
    });
    const at = this.deps.now();
    const approved = await this.deps.requests.approve({
      id: row.id,
      at,
      spendApproved,
      credentialId,
      signature: assertion.response.signature,
      signedHash: challenge,
    });
    if (!approved) await this.throwUndecidable({ id: row.id });

    const approver = await this.deps.users.findById({ id: userId });
    if (row.organizationId) {
      await this.recordApproval({
        id: row.id,
        entry: {
          organizationId: row.organizationId,
          userId,
          actorUserId: userId,
          action: "staffAccess.approved",
          targetKind: "staffAccess",
          targetId: row.id,
          ...(row.requestIp ? { ipAddress: row.requestIp } : {}),
          metadata: {
            principal: STAFF_ACCESS_PRINCIPAL,
            approvedBy: {
              id: userId,
              name: approver?.name ?? null,
              email: approver?.email ?? null,
            },
            reason: row.reason,
            scopes: row.scopes,
            spendApproved,
            machine: row.machine,
            ...(row.counterpartOrganizationId
              ? {
                  copy: {
                    counterpartOrganizationId: row.counterpartOrganizationId,
                    counterpartOrganizationName: row.counterpartOrganizationName,
                    grant: staffCopyGrant(row.scopes),
                  },
                }
              : {}),
          },
        },
      });
    }
    await this.deps.notices.tellOtherOperators({
      actingUserId: userId,
      subject: "An operator approved staff access",
      lines: [
        { label: "Organization", value: row.organizationName ?? "None (ops read only)" },
        { label: "Scopes", value: row.scopes.join(", ") },
        ...(row.counterpartOrganizationName
          ? [{ label: "Other organization of the copy", value: row.counterpartOrganizationName }]
          : []),
        { label: "Reason", value: row.reason },
        { label: "Machine", value: row.machine },
        { label: "Runs that spend allowed", value: spendApproved ? "Yes" : "No" },
      ],
      idempotencyKey: `staff-access-approved:${row.id}`,
    });
    return this.approvalViewOf(await this.rowOf({ id: row.id }));
  }

  /**
   * An approval the customer's audit log did not take must not stand: the request is ended
   * without a customer row and the operator is refused.
   * @throws {StaffAccessAuditUnavailableError} when the audit write fails
   */
  private async recordApproval({
    id,
    entry,
  }: {
    id: string;
    entry: Parameters<AuditLogApi["record"]>[0];
  }): Promise<void> {
    try {
      await this.deps.auditLog.record(entry);
    } catch {
      await this.deps.requests.revoke({
        id,
        at: this.deps.now(),
        byUserId: entry.actorUserId ?? null,
        cause: "approval_audit_failed",
      });
      throw new StaffAccessAuditUnavailableError();
    }
  }

  async deny({
    userId,
    requestId,
  }: {
    userId: string;
    requestId: string;
  }): Promise<StaffAccessApprovalView> {
    const row = await this.requestOfOwner({ userId, requestId });
    if (!(await this.deps.requests.deny({ id: row.id, at: this.deps.now() }))) {
      await this.throwUndecidable({ id: row.id });
    }
    return this.approvalViewOf(await this.rowOf({ id: row.id }));
  }

  /**
   * Redeems an approved request once, for its own requester, with the verifier behind its
   * challenge. A wrong verifier spends nothing. The session is pinned to the redeeming address.
   */
  async redeem({
    requesterId,
    requestId,
    codeVerifier,
    ipAddress,
  }: {
    requesterId: string;
    requestId: string;
    codeVerifier: string;
    ipAddress: string | null;
  }): Promise<StaffAccessRedeemed> {
    const row = await this.requestOfRequester({ requesterId, requestId });
    const at = this.deps.now();
    assertRedeemable({ row, at });
    if (pkceChallengeOf(codeVerifier) !== row.codeChallenge) {
      throw new StaffAccessInvalidCodeVerifierError();
    }
    const accessExpiresAt = later({ at, ms: STAFF_ACCESS_SESSION_TTL_MS });
    const redeemed = await this.deps.requests.redeem({
      id: row.id,
      requesterId,
      at,
      pinnedIp: ipAddress,
      accessExpiresAt,
    });
    if (!redeemed) {
      assertRedeemable({ row: await this.rowOf({ id: row.id }), at });
      throw new StaffAccessAlreadyRedeemedError();
    }

    try {
      return await this.mintCredentials({ row, accessExpiresAt });
    } catch (error) {
      await this.deps.sessions.endSession({ row, byUserId: null, cause: "mint_failed" });
      throw error;
    }
  }

  private async mintCredentials({
    row,
    accessExpiresAt,
  }: {
    row: StaffAccessRequestRow;
    accessExpiresAt: Instant;
  }): Promise<StaffAccessRedeemed> {
    const scopes = row.scopes as StaffAccessScope[];
    const organizationKey =
      reachesOrganization(scopes) && row.organizationId
        ? await this.deps.apiKeys.mintStaffAccessKey({
            organizationId: row.organizationId,
            permissions: staffAccessPermissions({ scopes }),
            expiresAt: toDate(accessExpiresAt),
            kind: staffKeyKindOf(scopes),
          })
        : null;
    const opsToken = mintsOpsToken(scopes) ? mintToken(STAFF_ACCESS_OPS_TOKEN_PREFIX) : null;
    await this.deps.requests.attachCredentials({
      id: row.id,
      apiKeyId: organizationKey?.apiKeyId ?? null,
      hashedOpsToken: opsToken?.hashedSecret ?? null,
      opsTokenLookupId: opsToken?.lookupId ?? null,
    });
    const projects =
      organizationKey && row.organizationId
        ? (
            await this.deps.projects.listByOrganization({
              organizationId: row.organizationId,
              page: 1,
              limit: PROJECTS_LISTED,
            })
          ).data.map((project) => ({ id: project.id, slug: project.slug, name: project.name }))
        : [];

    return {
      ...(organizationKey ? { apiKey: organizationKey.token } : {}),
      ...(opsToken ? { opsToken: opsToken.token } : {}),
      ...(row.organizationId ? { organizationId: row.organizationId } : {}),
      projects,
      scopes,
      expiresAt: isoText(accessExpiresAt),
    };
  }

  /** Every check a decision needs, then the hash it signs. */
  private async decidable({
    userId,
    choice,
  }: {
    userId: string;
    choice: Choice;
  }): Promise<{ row: StaffAccessRequestRow; challenge: string; spendApproved: boolean }> {
    const row = await this.requestOfOwner({ userId, requestId: choice.requestId });
    const scopes = row.scopes as StaffAccessScope[];
    assertPending({ row, at: this.deps.now() });
    const spendApproved = choice.spendApproved && scopes.includes("org:support");
    if (
      typedNameRequired({ scopes, spendApproved }) &&
      !organizationNameMatches({
        typed: choice.typedOrganizationName,
        actual: row.organizationName,
      })
    ) {
      throw new StaffAccessOrganizationNameMismatchError();
    }
    const challenge = approvalChallengeOf(approvalFieldsOf({ row, spendApproved }));
    return { row, challenge, spendApproved };
  }

  private async throwUndecidable({ id }: { id: string }): Promise<never> {
    assertPending({ row: await this.rowOf({ id }), at: this.deps.now() });
    throw new StaffAccessRequestNotPendingError();
  }

  private async resolveOrganization({
    organization,
  }: {
    organization: string;
  }): Promise<OrganizationProvisioningSummary> {
    const byId = await this.deps.organizations.findProvisioningSummary(organization);
    if (byId) return byId;
    const all = await this.deps.organizations.listProvisioningSummaries();
    const bySlug = all.find((summary) => summary.slug === organization);
    if (!bySlug) throw new StaffAccessNotFoundError();
    return bySlug;
  }

  private async rowOf({ id }: { id: string }): Promise<StaffAccessRequestRow> {
    const [row] = await this.deps.requests.findById({ id });
    if (!row) throw new StaffAccessNotFoundError();
    return row;
  }

  private async requestOfOwner({
    userId,
    requestId,
  }: {
    userId: string;
    requestId: string;
  }): Promise<StaffAccessRequestRow> {
    const [row] = await this.deps.requests.findById({ id: requestId });
    if (!row || row.ownerUserId !== userId) throw new StaffAccessNotFoundError();
    return row;
  }

  private async requestOfRequester({
    requesterId,
    requestId,
  }: {
    requesterId: string;
    requestId: string;
  }): Promise<StaffAccessRequestRow> {
    const [row] = await this.deps.requests.findById({ id: requestId });
    if (!row || row.requesterId !== requesterId) throw new StaffAccessNotFoundError();
    return row;
  }

  private async approvalViewOf(row: StaffAccessRequestRow): Promise<StaffAccessApprovalView> {
    const [view] = await this.deps.sessions.viewsOf({ rows: [row] });
    const scopes = row.scopes as StaffAccessScope[];
    return {
      ...(view as StaffAccessSessionView),
      typedNameRequired: {
        withSpend: typedNameRequired({ scopes, spendApproved: scopes.includes("org:support") }),
        withoutSpend: typedNameRequired({ scopes, spendApproved: false }),
      },
      spendOffered: scopes.includes("org:support"),
      copyGrant: staffCopyGrant(scopes),
    };
  }
}
