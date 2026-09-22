// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What an organization's own administrator reads about its connection, as
 * distinct from the back office's cross-tenant surface. Spec:
 * specs/identity/sso-connection-history.feature.
 */
import { z } from "zod";

/** Which connection of the caller's own organization is being read. */
export const ssoSetupConnectionSchema = z.object({
  organizationId: z.string().min(1),
  connectionId: z.string().min(1),
});

export type SsoSetupConnectionInput = z.infer<typeof ssoSetupConnectionSchema>;

/** Whose setup journey is being read. */
export const ssoSetupOrganizationSchema = z.object({ organizationId: z.string().min(1) });

export type SsoSetupOrganizationInput = z.infer<typeof ssoSetupOrganizationSchema>;

/**
 * Where an organization's setup stands, as the page reads it in one go.
 *
 * The spellings are identity's own (`SsoSetupView`), repeated here because a
 * wire schema is this module's own statement of what it sends; the transport
 * maps identity's read onto it, and a value identity stops sending fails to
 * compile rather than reaching a screen as undefined.
 */
/** How a domain was proved, in identity's own spellings. */
const ssoSetupVerificationMethodSchema = z.enum([
  "dns-txt",
  "https-file",
  "license-token",
  "operator-attested",
  "legacy-configuration",
]);

/** Which connection of a migration pair a reference names. */
const ssoSetupConnectionSourceSchema = z.enum(["self-serve", "legacy-grandfathered"]);

const ssoSetupProofSchema = z
  .object({
    domain: z.string(),
    method: ssoSetupVerificationMethodSchema,
    qualification: z.enum(["QUALIFIED", "UNKNOWN", "LAPSED"]),
    proofState: z.enum(["VERIFIED", "WAVERING", "LAPSED"]),
    /** When a lapse becomes final; null while the evidence is there. */
    graceEndsAtMs: z.number().nullable(),
    verifiedAtMs: z.number(),
    verifier: z.object({ type: z.enum(["user", "system"]), id: z.string().nullable() }).strict(),
  })
  .strict();

const ssoSetupClaimSchema = z
  .object({
    domain: z.string(),
    state: z.enum(["CLAIMED", "APPROVED", "REJECTED"]),
    /** Why an operator refused it, so a re-claim starts from what they said. */
    note: z.string().nullable(),
    waitsForReview: z.boolean(),
  })
  .strict();

const ssoSetupRecordSchema = z
  .object({
    domain: z.string(),
    method: ssoSetupVerificationMethodSchema,
    expiresAtMs: z.number().nullable(),
    expired: z.boolean(),
  })
  .strict();

const ssoSetupGoLiveSchema = z
  .object({
    domainProved: z.boolean(),
    testSignIn: z.object({ done: z.boolean() }).strict(),
    breakGlass: z.object({ inPlace: z.boolean(), liveCount: z.number() }).strict(),
    arrivalsDecided: z.boolean(),
    ready: z.boolean(),
    activated: z.boolean(),
  })
  .strict();

const ssoSetupConnectionViewSchema = z
  .object({
    connectionId: z.string(),
    state: z.enum([
      "DRAFT",
      "CLAIMED",
      "APPROVED",
      "REJECTED",
      "DISCARDED",
      "VERIFICATION_PENDING",
      "VERIFIED",
      "ACTIVE",
      "SUSPENDED",
      "TEARDOWN_PENDING",
      "TORN_DOWN",
    ]),
    type: z.enum(["oidc", "saml"]),
    providerId: z.string(),
    issuer: z.string().nullable(),
    source: ssoSetupConnectionSourceSchema,
    arrivalPolicy: z.enum(["admit", "request", "refuse"]),
    /** Null while the registration default stands: going live waits for a
     *  decision, and "turn everybody away" is a decision too. */
    arrivalPolicyDecidedAtMs: z.number().nullable(),
    tearDownAfterMs: z.number().nullable(),
    createdAtMs: z.number(),
    verifiedDomains: z.array(z.string()),
    domainProofs: z.array(ssoSetupProofSchema),
  })
  .strict();

/**
 * Where one organization's legacy-to-direct cutover stands, as the card reads
 * it. Everything here is re-read on every request: finalizing never trusts a
 * snapshot a screen was holding. Identity's `SsoMigrationView`, repeated for
 * the reason the page view above is repeated.
 */
const ssoMigrationConnectionRefSchema = z
  .object({
    connectionId: z.string(),
    source: ssoSetupConnectionSourceSchema,
    providerId: z.string(),
  })
  .strict();

const ssoMigrationStragglerSchema = z
  .object({
    userId: z.string(),
    name: z.string().nullable(),
    email: z.string().nullable(),
    lastLegacyAuthenticationAtMs: z.number().nullable(),
  })
  .strict();

export const ssoSetupMigrationSchema = z
  .object({
    legacy: ssoMigrationConnectionRefSchema,
    replacement: ssoMigrationConnectionRefSchema,
    phase: z.enum(["SETUP", "GRACE_LEGACY", "GRACE_DIRECT", "FINALIZING", "FINALIZED"]),
    /** Which half decides an ordinary sign-in while the pair stands. */
    selectedRoute: z.enum(["legacy", "direct"]),
    /** The proofs the replacement was registered with, still qualifying. */
    inheritedDomains: z.array(
      z
        .object({
          domain: z.string(),
          method: ssoSetupVerificationMethodSchema,
          proofState: z.enum(["VERIFIED", "WAVERING", "LAPSED"]),
          /** What the proof was read back against; null for one that
           *  published nothing. */
          evidenceRef: z.string().nullable(),
          verifiedAtMs: z.number(),
        })
        .strict(),
    ),
    testSignIn: z.object({ done: z.boolean(), atMs: z.number().nullable() }).strict(),
    members: z
      .object({
        activeCount: z.number(),
        linkedCount: z.number(),
        stragglers: z.array(ssoMigrationStragglerSchema),
        nextCursor: z.string().nullable(),
      })
      .strict(),
    quietPeriod: z
      .object({ lastLegacyAuthenticationAtMs: z.number().nullable(), complete: z.boolean() })
      .strict(),
    /** Whether directory provisioning still points at the connection being
     *  retired. */
    scim: z.object({ status: z.enum(["not-applicable", "needs-repointing", "ready"]) }).strict(),
    /** One reason finalizing would be premature, in the words the reader acts on. */
    blockers: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
    canFinalize: z.boolean(),
  })
  .strict();

export type SsoSetupMigration = z.infer<typeof ssoSetupMigrationSchema>;

export const ssoSetupPageViewSchema = z
  .object({
    /** Null before the organization has registered its first connection. */
    connection: ssoSetupConnectionViewSchema.nullable(),
    claims: z.array(ssoSetupClaimSchema),
    record: ssoSetupRecordSchema.nullable(),
    goLive: ssoSetupGoLiveSchema.nullable(),
    /** The compatibility route a grandfathered connection stands in for. It
     *  names its connection: a replacement registered against that id
     *  inherits what it proved, where one registered against nothing is a
     *  rival to the route people are signing in through right now. */
    legacyRoute: z
      .object({ connectionId: z.string(), domain: z.string(), provider: z.string() })
      .strict()
      .nullable(),
    /** Where the cutover stands, when this connection replaces a
     *  grandfathered one. Null for every connection outside a pair. */
    migration: ssoSetupMigrationSchema.nullable(),
    /** The addresses an identity provider is pointed at. This module serves
     *  them, so identity's own read does not answer them. */
    serviceProvider: z
      .object({
        redirectUrl: z.string(),
        assertionConsumerServiceUrl: z.string(),
        singleLogoutUrl: z.string(),
        entityId: z.string(),
        metadataUrl: z.string(),
      })
      .strict(),
  })
  .strict();

export type SsoSetupPageView = z.infer<typeof ssoSetupPageViewSchema>;

/**
 * One line of a connection's history, already in a reader's words: identity
 * composes the sentence, so no surface has to know an event's internal name.
 */
export const ssoConnectionHistoryEntrySchema = z
  .object({
    eventId: z.string(),
    occurredAtMs: z.number(),
    summary: z.string(),
    /** True where the grandfather migration produced the fact, not a person. */
    carriedOver: z.boolean(),
  })
  .strict();

export type SsoConnectionHistoryEntry = z.infer<typeof ssoConnectionHistoryEntrySchema>;

/**
 * A bare "something changed here", which is the whole signal: the page
 * refreshes the history read it already has permission for, so the tick
 * itself discloses nothing.
 */
export const ssoHistoryActivitySchema = z.object({ connectionId: z.string() }).strict();

export type SsoHistoryActivity = z.infer<typeof ssoHistoryActivitySchema>;

/** One domain of the caller's own connection. Separate from the back
 *  office's target of the same shape: the two surfaces are gated apart. */
export const ssoSetupDomainSchema = z.object({
  ...ssoSetupConnectionSchema.shape,
  domain: z.string().min(1).max(253),
});

export type SsoSetupDomainInput = z.infer<typeof ssoSetupDomainSchema>;

/**
 * What a claim answers: whether a person has to look at it before the domain
 * routes, and whether somebody else has already proved the same domain.
 */
export const ssoDomainClaimOutcomeSchema = z
  .object({ waitsForReview: z.boolean(), disputed: z.boolean() })
  .strict();

export type SsoDomainClaimOutcome = z.infer<typeof ssoDomainClaimOutcomeSchema>;

/** Where one domain's proof goes, and the token to publish there. Answered
 *  once: identity keeps only the hash, so a lost value is replaced. */
export const ssoIssuedDnsRecordSchema = z
  .object({
    domain: z.string(),
    label: z.string(),
    name: z.string(),
    type: z.string(),
    file: z.object({ path: z.string(), url: z.string() }).strict(),
    value: z.string(),
    expiresAtMs: z.number(),
  })
  .strict();

export type SsoIssuedDnsRecord = z.infer<typeof ssoIssuedDnsRecordSchema>;

/** Either the domain already proves itself, or here is what to publish. */
export const ssoDomainProofSchema = z.discriminatedUnion("proved", [
  z.object({ proved: z.literal(true) }).strict(),
  z.object({ proved: z.literal(false), record: ssoIssuedDnsRecordSchema }).strict(),
]);

export type SsoDomainProof = z.infer<typeof ssoDomainProofSchema>;

/** A check answers only that it proved: anything else is a refusal. */
export const ssoDomainProvedSchema = z.object({ proved: z.literal(true) }).strict();

export type SsoDomainProved = z.infer<typeof ssoDomainProvedSchema>;

/**
 * What an administrator hands over to register their identity provider (D09).
 * Two protocols and one shape each, discriminated rather than a bag of
 * optional fields, because half the combinations are nonsense. Identity's
 * spellings, repeated for the same reason the page view above repeats them.
 */
export const ssoSetupOidcRegistrationSchema = z.object({
  protocol: z.literal("oidc"),
  /** The address the discovery document lives under. */
  issuer: z.string().trim().min(1).max(2048),
  clientId: z.string().trim().min(1).max(512),
  clientSecret: z.string().min(1).max(4096),
});

export const ssoSetupSamlRegistrationSchema = z.object({
  protocol: z.literal("saml"),
  /** Where a sign-in request is sent. */
  entryPoint: z.string().trim().min(1).max(2048),
  /** Derivable from metadata, so either this or `metadataXml` has to be there
   *  and neither alone is required. */
  entityId: z.string().trim().max(2048).nullable().default(null),
  metadataXml: z.string().max(512_000).nullable().default(null),
  certificate: z.string().max(64_000).nullable().default(null),
});

export const ssoSetupRegistrationSchema = z.discriminatedUnion("protocol", [
  ssoSetupOidcRegistrationSchema,
  ssoSetupSamlRegistrationSchema,
]);

export type SsoSetupRegistration = z.infer<typeof ssoSetupRegistrationSchema>;

export const ssoSetupRegisterSchema = z.object({
  ...ssoSetupOrganizationSchema.shape,
  /** What the administrator calls this provider. */
  providerId: z.string().min(1).max(100),
  idp: ssoSetupRegistrationSchema,
});

export type SsoSetupRegisterInput = z.infer<typeof ssoSetupRegisterSchema>;

/** The connection registering minted, which the page reads back straight away. */
export const ssoSetupRegisteredSchema = z.object({ connectionId: z.string() }).strict();

export type SsoSetupRegistered = z.infer<typeof ssoSetupRegisteredSchema>;

/** Who the connection admits (ADR-117 §3). `policy` is the wire's word. */
export const ssoSetupArrivalsSchema = z.object({
  ...ssoSetupConnectionSchema.shape,
  policy: z.enum(["admit", "request", "refuse"]),
});

export type SsoSetupArrivalsInput = z.infer<typeof ssoSetupArrivalsSchema>;

/** Taking a connection away. WHICH removal that is comes from where the
 *  connection stands, so the caller states a reason and nothing else. */
export const ssoSetupRemovalSchema = z.object({
  ...ssoSetupConnectionSchema.shape,
  reason: z.string().min(1).max(1000).nullable().default(null),
});

export type SsoSetupRemovalInput = z.infer<typeof ssoSetupRemovalSchema>;

/** One page of a cutover's members. The first page arrives with the setup
 *  read; this is how the card asks for the rest. */
export const ssoSetupMigrationProgressSchema = z.object({
  ...ssoSetupConnectionSchema.shape,
  cursor: z.string().min(1).nullable().default(null),
  limit: z.number().int().min(1).max(100).default(25),
});

export type SsoSetupMigrationProgressInput = z.infer<typeof ssoSetupMigrationProgressSchema>;

/**
 * The direct replacement for a grandfathered connection, registered with the
 * same evidence an ordinary registration takes — and carrying over the
 * domains the connection it replaces has already proved.
 */
export const ssoSetupStartMigrationSchema = z.object({
  ...ssoSetupOrganizationSchema.shape,
  legacyConnectionId: z.string().min(1),
  providerId: z.string().min(1).max(100),
  idp: ssoSetupRegistrationSchema,
});

export type SsoSetupStartMigrationInput = z.infer<typeof ssoSetupStartMigrationSchema>;

/** Which half of a migration pair decides ordinary sign-ins. */
export const ssoSetupMigrationRouteSchema = z.object({
  ...ssoSetupConnectionSchema.shape,
  route: z.enum(["legacy", "direct"]),
});

export type SsoSetupMigrationRouteInput = z.infer<typeof ssoSetupMigrationRouteSchema>;

/** The word on the card; nothing routes on it. */
export const ssoSetupRenameSchema = z.object({
  ...ssoSetupConnectionSchema.shape,
  name: z.string().trim().min(1).max(120),
});

export type SsoSetupRenameInput = z.infer<typeof ssoSetupRenameSchema>;
