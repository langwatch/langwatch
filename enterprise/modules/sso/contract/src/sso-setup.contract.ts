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
