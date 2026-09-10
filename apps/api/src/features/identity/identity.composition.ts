/**
 * `identity.*` — the address ledger, the two-step and SSO connection guards,
 * the backfill pass and the newborn sweep (ADR-101, ADR-115, ADR-116,
 * ADR-117). This process has no transport of its own, so it never boots the
 * module on its own runtime: `user.composition.ts` installs `identityServer`
 * on the ONE runtime it shares with `authServer`/`userServer`, built from the
 * infrastructure this file supplies.
 */
import {
  AdminEmailPlatformOperatorsRepository,
  IDENTITY_LATCH_CACHE_MAX_USERS,
  IDENTITY_LATCH_CACHE_TTL_MS,
  type IdentityEventingPort,
  type IdentityInfrastructure,
  IdentityLedgerWriterAdapter,
  type JoinRequestMailPort,
  type PlatformOperatorPort,
  PrismaIdentityProjectionRepository,
  PrismaIdentityReservationRepository,
  PrismaIdentitySecretCarryRepository,
  PrismaJoinRequestAudienceRepository,
  PrismaScimSyncProjectionRepository,
  PrismaSsoConnectionProjectionRepository,
  type SsoConnectionEvent,
  SsoConnectionLedgerWriterAdapter,
  type SsoConnectionStagedSender,
} from "@langwatch/identity-server";
import { SSO_CONNECTION_PIPELINE_NAME } from "@langwatch/identity-contract";
import type { EventSourcing } from "@langwatch/eventing";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

export type ApiIdentityInfrastructureOptions = Readonly<{
  /** This process's own guarded connection. */
  prisma: PrismaClient;
  /** How every identity command stages. */
  eventing: IdentityEventingPort;
  /** The deployment's operator list, for the SSO connection guards. */
  operators: PlatformOperatorPort;
  /** How the two wake-driven join-request mails are sent, or none. */
  mail: JoinRequestMailPort | null;
  /**
   * The runtime the SSO connection ledger appends through, or none. Absent
   * on a process with no queue: `ssoConnections`/`ssoBackoffice` then refuse
   * by name rather than answering emptily (Q3(c)).
   */
  eventSourcing: EventSourcing | undefined;
}>;

/** What this process hands `identityServer` at boot, built from its own graph. */
export function apiIdentityInfrastructure(
  options: ApiIdentityInfrastructureOptions,
): IdentityInfrastructure {
  const { prisma } = options;

  return {
    eventing: options.eventing,
    operators: options.operators,
    mail: options.mail,
    latch: {
      ttlMs: IDENTITY_LATCH_CACHE_TTL_MS,
      maxUsers: IDENTITY_LATCH_CACHE_MAX_USERS,
      now: Date.now,
    },
    ledger: IdentityLedgerWriterAdapter.create({
      projectionStore: PrismaIdentityProjectionRepository.create({
        prisma,
        reservations: PrismaIdentityReservationRepository.create(prisma),
      }),
      eventing: options.eventing,
    }),
    secrets: PrismaIdentitySecretCarryRepository.create(prisma),
    joinRequestAudience: PrismaJoinRequestAudienceRepository.create(prisma),
    ssoPlatformOperators: AdminEmailPlatformOperatorsRepository.create({
      database: prisma,
      operators: options.operators,
    }),
    ssoConnectionLedger: options.eventSourcing
      ? ssoConnectionLedger({ prisma, eventSourcing: options.eventSourcing })
      : null,
    scimSyncs: PrismaScimSyncProjectionRepository.create(prisma),
  };
}

/**
 * Lifted verbatim (Step 8's rule) from `postgres.sso-connection-pipeline.adapter.ts`'s
 * ledger writer, over this process's own `eventSourcing`. Every command not
 * currently staged answers `null`, which the guards read as "not commandable
 * on this process".
 */
function ssoConnectionLedger(options: {
  prisma: PrismaClient;
  eventSourcing: EventSourcing;
}): SsoConnectionLedgerWriterAdapter {
  const { prisma, eventSourcing } = options;

  return SsoConnectionLedgerWriterAdapter.create({
    projectionStore: PrismaSsoConnectionProjectionRepository.create(prisma),
    eventStore: async () => {
      const eventStore = eventSourcing.isEnabled
        ? eventSourcing.getEventStore<SsoConnectionEvent>()
        : undefined;
      if (!eventStore) {
        throw new Error(
          "sso connection ledger cannot append: the event-sourcing stack is unavailable",
        );
      }
      return eventStore;
    },
    stagedSender: (name) => {
      if (!eventSourcing.isEnabled) return null;
      try {
        const pipeline = eventSourcing.getPipeline(SSO_CONNECTION_PIPELINE_NAME as never) as unknown as {
          commands: Record<string, SsoConnectionStagedSender>;
        };
        return pipeline.commands[name] ?? null;
      } catch {
        return null;
      }
    },
  });
}
