/**
 * The operator lookup's composition (D05).
 *
 * A file of its own rather than more lines in `runtime.ts`, for one
 * structural reason: confirming a waiting sign-in makes the link through
 * better-auth's own account creation, so this composition reaches
 * `~/server/better-auth` — and `~/server/better-auth` reaches `runtime.ts`
 * for its ceremonies. Composing the lookup there would close that loop.
 * `two-step-runtime.ts` is the same shape for the same kind of reason.
 *
 * Everything here is composed PER CALL, like the write surfaces next door:
 * the ledger writer resolves the pipeline handle lazily, so a service built
 * before the App exists still appends once one does.
 */
import {
  LinkProposalGuards,
  LinkProposalService,
} from "@langwatch/identity-server";
import { prisma } from "../../db";
import { IdentityLookupService } from "./identity-lookup.service";
import {
  BetterAuthLinkProposalDirectory,
  BetterAuthOperatorSessions,
  InviteServiceOperatorInvitations,
} from "./identity-lookup-adapters";
import { IdentityLedgerWriter } from "./ledger";
import { EventLogIdentityRepository } from "./repositories/identity-event-log.repository";
import { PrismaIdentityLookupRepository } from "./repositories/identity-lookup.prisma.repository";
import {
  identityProjectionStore,
  identityService,
  sessionRevocation,
  signInRouter,
} from "./runtime";

/**
 * The proposal log, read. One instance: it holds no request state, and its
 * event-store handle is resolved per read anyway.
 */
const identityEventLog = new EventLogIdentityRepository();

/**
 * Deciding a waiting sign-in (ADR-117 §3). The ONLY way a proposal is
 * decided — nothing writes a decision anywhere else, because there is
 * nowhere else to write one: a decision is a fact on the person's history.
 */
export function linkProposals(): LinkProposalService {
  return new LinkProposalService({
    guards: new LinkProposalGuards({ proposals: identityEventLog }),
    // The shared factory, not a second construction: the store also releases
    // the address locks a user stops holding, and it needs the reservation
    // repository to do it.
    ledger: new IdentityLedgerWriter({
      projectionStore: identityProjectionStore(),
    }),
    proposals: identityEventLog,
    directory: new BetterAuthLinkProposalDirectory(prisma),
  });
}

/** The platform operator's identity lookup (D05). */
export function identityLookup(): IdentityLookupService {
  return new IdentityLookupService({
    reads: new PrismaIdentityLookupRepository(prisma),
    history: identityEventLog,
    proposals: identityEventLog,
    router: signInRouter,
    identity: identityService,
    links: linkProposals,
    sessions: new BetterAuthOperatorSessions(sessionRevocation()),
    invitations: new InviteServiceOperatorInvitations(prisma),
  });
}
