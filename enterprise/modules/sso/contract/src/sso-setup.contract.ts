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
