// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The wire of a license sync (ADR-156, section 6): what an install may send,
 * what it gets back, and every code either host can refuse it with.
 */

import { z } from "zod";

import type { ConnectService } from "./connect-services.ts";
import type { ConnectCredentialGrant } from "./issued-license.ts";

/**
 * Exactly what a sync may carry: the version and the two seat counts. No
 * organization name, no hostname, no user data and no statistics, and
 * `.strict()` is what keeps it that way as the install side grows.
 */
export const licenseSyncBodySchema = z
  .object({
    version: z.string().min(1).max(100),
    seats: z
      .object({
        members: z.number().int().min(0),
        liteMembers: z.number().int().min(0),
      })
      .strict(),
  })
  .strict();

export type LicenseSyncBody = z.infer<typeof licenseSyncBodySchema>;

/** The two headers every call to the connect host presents its credential in. */
export const connectHostHeadersSchema = z.object({
  authorization: z.string().optional(),
  "x-langwatch-instance": z.string().optional(),
});

/** An activation carries its code in the bearer header, so its body names nothing. */
export const connectActivationRequestSchema = z.object({});

/** A credential as presented: the raw bearer header and the instance id, both unchecked. */
export interface ConnectPresentedCredential {
  authorization: string | undefined;
  instanceId: string | undefined;
}

/** Every refusal of a credential resolution, with the status the host answers. */
export const CONNECT_CREDENTIAL_REFUSALS = {
  connect_license_token_malformed: { status: 401, message: "the license token is malformed" },
  connect_instance_required: {
    status: 400,
    message: "a license token must be presented with an instance id",
  },
  connect_license_not_registered: {
    status: 401,
    message: "this license is not registered for hosted services",
  },
  connect_license_revoked: { status: 403, message: "this license is no longer active" },
  connect_license_expired: { status: 403, message: "this license has expired" },
  connect_wrong_instance: { status: 403, message: "this license is bound to another instance" },
} as const;

export type ConnectCredentialRefusalCode = keyof typeof CONNECT_CREDENTIAL_REFUSALS;

/** The two refusals a sync adds to the credential's own. */
export const LICENSE_SYNC_REFUSALS = {
  ...CONNECT_CREDENTIAL_REFUSALS,
  validation_error: {
    status: 400,
    message: "a sync carries a version and two whole, non-negative seat counts",
  },
  rate_limited: { status: 429, message: "this license has synced too many times today" },
} as const;

export type LicenseSyncRefusalCode = keyof typeof LICENSE_SYNC_REFUSALS;

export type LicenseSyncResult =
  | {
      ok: true;
      /** The hosted services the license is entitled to, as the registry has them. */
      services: ConnectService[];
      /** A reissued license waiting for this install, sent until it presents it. */
      license?: string;
    }
  | { ok: false; code: LicenseSyncRefusalCode };

/** What resolving a presented license token answers, on either host. */
export type ConnectCredentialResolution =
  | { ok: true; grant: ConnectCredentialGrant }
  | { ok: false; code: ConnectCredentialRefusalCode };
