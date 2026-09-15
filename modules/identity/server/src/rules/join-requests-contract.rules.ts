/**
 * What a join request is asked with, and the fixed quantities the asking is bounded by: how
 * often somebody may ask and look, how long a rejection holds them off, and the narrow
 * collaborator shapes the service is given rather than reaching for.
 */
import { SYSTEM_ACTORS } from "@langwatch/actor";
import { type DomainJoinSetting } from "@langwatch/identity-contract";
import type {
  JoinCandidateRepository,
  JoinRequestListReadRepository,
} from "../repositories/join-request.repository.ts";
import type { JoinRequestService } from "../services/join-request.service.ts";
import {} from "../rules/join-request-id.rules.ts";

/**
 * How often somebody may ask, and how often they may look. The sign-in endpoints' own shape
 * (`frontDoor.ts`): a per-actor sliding window, generous enough that nobody legitimate meets it and
 * tight enough that volume is not free.
 */
export const JOIN_REQUEST_RATE_WINDOW_SECONDS = 60 * 60;
export const JOIN_REQUESTS_PER_WINDOW = 5;
export const JOIN_LOOKUPS_PER_WINDOW = 60;

/**
 * How long a rejected person waits before asking the same organization again.
 */
export const JOIN_REJECTION_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/** What an organization's admins are told, and by what means. Injected so
 *  the mail is the app's business and this service stays testable. */
export interface JoinRequestNotifier {
  requestArrived(args: {
    joinRequestId: string;
    organizationId: string;
    requesterUserId: string;
    domain: string;
  }): Promise<void>;
  requestStillWaiting(args: { joinRequestId: string; organizationId: string }): Promise<void>;
  requestApproved(args: {
    joinRequestId: string;
    organizationId: string;
    requesterUserId: string;
  }): Promise<void>;
  requestRejected(args: {
    joinRequestId: string;
    organizationId: string;
    requesterUserId: string;
  }): Promise<void>;
  requestExpired(args: {
    joinRequestId: string;
    organizationId: string;
    requesterUserId: string;
  }): Promise<void>;
  joinedAutomatically(args: {
    joinRequestId: string;
    organizationId: string;
    requesterUserId: string;
    domain: string;
  }): Promise<void>;
}

/** How a membership actually lands: the same ledger an invitation uses. */
export interface JoinMembership {
  attachDefaultMembership(args: {
    userId: string;
    organizationId: string;
    /** The approving admin, or nobody when the policy approved. */
    approvedByUserId: string | null;
  }): Promise<void>;
  isMember(args: { userId: string; organizationId: string }): Promise<boolean>;
}

/** Whether this organization may change its joining setting, and to what. */
export interface JoinSetting {
  read(args: {
    organizationId: string;
  }): Promise<{ domainJoin: DomainJoinSetting; joinDomains: string[] }>;
  write(args: {
    organizationId: string;
    domainJoin: DomainJoinSetting;
    joinDomains: string[];
  }): Promise<void>;
}

export interface JoinRequestsServiceDeps {
  requests: JoinRequestService;
  reads: JoinRequestListReadRepository;
  candidates: JoinCandidateRepository;
  membership: JoinMembership;
  notifier: JoinRequestNotifier;
  settings: JoinSetting;
  /** The licence gate. Holds `auto`, lets `request` through. */
  autoJoinLicensed: () => Promise<boolean>;
  /** Whether any of this exists at all. Flag off, nothing here runs. */
  enabled: (args: { userId: string }) => Promise<boolean>;
  /**
   * The shared counter behind the two throttles. The process's, not this service's: it is the same
   * counter the sign-in doors and the public REST surface meter through, and a second one here
   * would let somebody spend a budget twice by asking on two paths.
   */
  rateLimit: (input: {
    key: string;
    windowSeconds: number;
    max: number;
  }) => Promise<{ allowed: boolean; resetAt: number }>;
  now?: () => number;
}
