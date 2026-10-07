// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { FoldProjectionStore } from "@langwatch/eventing";
import { ssoConnectionFoldedStateSchema } from "@langwatch/identity-contract";
import { z } from "zod";

/** One connection as identity's reducer folds it, plus the business time of its newest fact. */
export const scimSsoConnectionFoldStateSchema = z.object({
  ...ssoConnectionFoldedStateSchema.shape,
  LastEventOccurredAt: z.number(),
});
export type ScimSsoConnectionFoldState = z.infer<typeof scimSsoConnectionFoldStateSchema>;

/** The peer fold's version; a stored row of another version is re-folded from identity's log. */
export const SCIM_SSO_CONNECTION_PROJECTION_VERSION = "2026-10-07" as const;

/** SCIM's folded copy of the organization's SSO connections: the read over the peer fold's rows. */
export abstract class ScimSsoConnectionReadRepository {
  /** Every connection this organization holds, newest first; empty when it holds none. */
  abstract findForOrganization(args: {
    organizationId: string;
  }): Promise<ScimSsoConnectionFoldState[]>;
}

/** The peer fold's store and the read over the same rows. */
export type ScimSsoConnectionRepository = FoldProjectionStore<ScimSsoConnectionFoldState> &
  ScimSsoConnectionReadRepository;
