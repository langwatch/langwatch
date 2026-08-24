/**
 * @langwatch/identity-server — the server-side runtime of the identity
 * platform (ADR-101, ADR-115), in the app-layer service/repository shape:
 * service CLASSES over repository INTERFACES.
 *
 *   IdentityGuards               veto-before-write over IdentityHeadsRepository;
 *                                one implementation for the calling path AND
 *                                the queue's staged re-run
 *   IdentityService              the five verbs: parse → guard → IdentityLedger.commit,
 *                                sliced by role into IdentityCeremonyWrites /
 *                                IdentityVerificationWrites / IdentityAdoptionWrites
 *   VerificationCeremonyService  PKCE magic-link mint / complete
 *   IdentityBackfillService      one user's ADR-101 §6 pass: adopt, establish,
 *                                detach orphans, prove
 *   crypto                       deriveIdentifierId, computeIdentifierHash,
 *                                mintUserHashKey, the PKCE helpers
 *   IdentityEmailService         the READ fork: User.email answered from the
 *                                identifiers for a finalized user
 *   identity-command-id          every form a command id takes, in one place
 *   identity-backfill-plan       what the legacy rows imply, as a pure plan
 *   ./better-auth                the ceremonies better-auth's databaseHooks
 *                                call; no adapter, no storage (ADR-116)
 *
 * No storage engine lives here, no environment read, and no event-sourcing
 * framework: the heads, the ledger and the records are ports the app
 * implements (platform/app/src/server/app-layer/identity/repositories/ and
 * ledger.ts) and composes once in its runtime
 * (platform/app/src/server/app-layer/identity/runtime.ts). The pure half —
 * vocabulary, facts, the reducer, the errors — is `@langwatch/identity`.
 *
 * Server-only by construction: nothing in the browser reaches this package,
 * and the app's frontend-boundary test fails the build the day that stops
 * being true. That is why node:crypto sits on the root entry rather than
 * behind a subpath.
 */
export {
  computeIdentifierHash,
  deriveIdentifierId,
} from "./crypto/identifier-identity";
export { s256Challenge } from "./crypto/pkce";
export { mintUserHashKey } from "./crypto/user-hash-key";
export { IdentityGuards } from "./guards";
export {
  type BackfillAccountRow,
  type BackfillUserRow,
  type IdentityBackfillRepository,
} from "./identity-backfill.repository";
export {
  type PlannedIdentifier,
  planIdentifiers,
} from "./identity-backfill-plan";
export {
  IDENTITY_BACKFILL_ACTOR,
  type IdentityBackfillOutcome,
  IdentityBackfillService,
  type IdentityBackfillServiceDeps,
} from "./identity-backfill.service";
export { IdentityEmailService } from "./identity-email.service";
export {
  adoptAccountCommandId,
  adoptUserEmailCommandId,
  detachOrphanCommandId,
  establishUserEmailCommandId,
  newIdentityCommandId,
} from "./identity-command-id";
export type { IdentityHeadsRepository } from "./identity-heads.repository";
export type { IdentityLedger } from "./identity-ledger";
export type { IdentityUserGate } from "./identity-user-gate";
export type { IdentityUsersRepository } from "./identity-users.repository";
export type {
  IdentityVerificationRecord,
  IdentityVerificationRepository,
} from "./identity-verification.repository";
export { IdentityService } from "./identity.service";
export type {
  IdentityAdoptionWrites,
  IdentityCeremonyWrites,
  IdentityVerificationWrites,
} from "./identity-writes";
export {
  IDENTITY_VERIFICATION_TTL_MS,
  type MintedEmailVerification,
  VerificationCeremonyService,
  type VerificationCeremonyDeps,
} from "./verification-ceremony.service";
