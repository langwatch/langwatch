/**
 * What the process supplies this feature that is not one of its twelve
 * repository rows: the eventing port, the operator list, the join-request
 * mail gateway, the latch cache's knobs, and the write-side heads the four
 * pipelines fold into (Q3(b) - each stays process-side rather than becoming
 * a thirteenth-and-up row, because building them needs `EventSourcing`).
 */
import type { IdentityEventingPort } from "../ports/identity-eventing.port.ts";
import type { JoinRequestMailPort } from "../ports/join-request-mail.port.ts";
import type { PlatformOperatorPort } from "../ports/platform-operator.port.ts";
import type { JoinRequestAudiencePort } from "../ports/join-request-audience.port.ts";
import type { IdentityLedger } from "../rules/identity-ledger.rules.ts";
import type { SsoConnectionLedger } from "../rules/sso-connection-ledger.rules.ts";
import type { IdentitySecretCarryRepository } from "../services/identity-secret-carry.service.ts";
import type { SsoPlatformOperatorRepository } from "../repositories/sso-connection.repository.ts";
import type { ScimSyncReadRepository } from "../repositories/scim-sync.repository.ts";

export type IdentityInfrastructure = Readonly<{
  /** How every identity command stages. Present in all three processes; a producer-only stand-in where the process composed no queue. */
  eventing: IdentityEventingPort;
  /** The deployment's operator list, for the SSO connection guards. `ADMIN_EMAILS`, not `ops:*`. */
  operators: PlatformOperatorPort;
  /** How the two wake-driven join-request mails are rendered and sent, or nothing where the process composed no gateway. */
  mail: JoinRequestMailPort | null;
  /** Overridden only by tests that need the latch to expire or evict inside one run. */
  latch: Readonly<{ ttlMs: number; maxUsers: number; now: () => number }>;
  /** The identifier ledger's append-and-converge surface, built by the process from its own Prisma client and its own `reservations` row. */
  ledger: IdentityLedger;
  /** The three backfill reads the D01 secret-carry pass writes through. */
  secrets: IdentitySecretCarryRepository;
  /** Who a join-request notification reaches. Read only when `mail` is present. */
  joinRequestAudience: JoinRequestAudiencePort;
  /** Who counts as a LangWatch platform operator, for the SSO connection guards (D05 tier 1). */
  ssoPlatformOperators: SsoPlatformOperatorRepository;
  /** The SSO connection ledger's append surface. */
  ssoConnectionLedger: SsoConnectionLedger;
  /** The folded state of one connection's directory sync (D08). */
  scimSyncs: ScimSyncReadRepository;
}>;
