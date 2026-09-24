import type { JoinRequestAudienceRepository } from "../repositories/join-request-audience.repository.ts";
import type { ScimSyncReadRepository } from "../repositories/scim-sync.repository.ts";
import type { SsoConnectionHistoryRepository } from "../repositories/sso-connection-history.repository.ts";
import type { SsoPlatformOperatorRepository } from "../repositories/sso-connection.repository.ts";
import type { IdentityLedger } from "../rules/identity-ledger.rules.ts";
import type { JoinRequestLedger } from "../rules/join-request-ledger.rules.ts";
import type { SsoConnectionLedger } from "../rules/sso-connection-ledger.rules.ts";
import type { IdentitySecretCarryRepository } from "../services/identity-secret-carry.service.ts";
/**
 * What the process supplies this feature beyond its twelve repository rows:
 * eventing, operators, join-request mail, latch knobs, write-side heads
 * (Q3(b) — each needs `EventSourcing`, so stays process-side).
 */
import {
  type IdentityEventing,
  type JoinRequestMail,
  type PlatformOperator,
} from "./identity.members.ts";

export type IdentityInfrastructure = Readonly<{
  /**
   * How every identity command stages. Present in all three processes; a
   * producer-only stand-in where the process composed no queue.
   */
  eventing: IdentityEventing;
  /** The deployment's operator list, for the SSO connection guards. `ADMIN_EMAILS`, not `ops:*`. */
  operators: PlatformOperator;
  /**
   * How the two wake-driven join-request mails are rendered and sent, or
   * nothing where the process composed no gateway.
   */
  mail: JoinRequestMail | null;
  /** Overridden only by tests that need the latch to expire or evict inside one run. */
  latch: Readonly<{ ttlMs: number; maxUsers: number; now: () => number }>;
  /**
   * The identifier ledger's append-and-converge surface, built by the
   * process from its own Prisma client and its own `reservations` row.
   */
  ledger: IdentityLedger;
  /** The join-request ledger's append-and-converge surface, over the same `eventing`. */
  joinRequestLedger: JoinRequestLedger;
  /** The three backfill reads the D01 secret-carry pass writes through. */
  secrets: IdentitySecretCarryRepository;
  /** Who a join-request notification reaches. Read only when `mail` is present. */
  joinRequestAudience: JoinRequestAudienceRepository;
  /** Who counts as a LangWatch platform operator, for the SSO connection guards (D05 tier 1). */
  ssoPlatformOperators: SsoPlatformOperatorRepository;
  /**
   * The SSO connection ledger's append surface, or nothing where the process
   * composed no SSO connection store. Mirrors `mail`: absent means the
   * capability refuses by name rather than answering emptily.
   */
  ssoConnectionLedger: SsoConnectionLedger | null;
  /**
   * One connection's own log, read. Null where the process composed no event
   * stack — the history refuses by name rather than reading as empty, which
   * would be indistinguishable from a connection nothing ever happened to.
   */
  ssoConnectionHistory: SsoConnectionHistoryRepository | null;
  /** The folded state of one connection's directory sync (D08). */
  scimSyncs: ScimSyncReadRepository;
}>;
