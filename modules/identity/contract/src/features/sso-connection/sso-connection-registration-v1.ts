/**
 * Version 1 of a connection registration as the immutable log stored it, and the pure transform
 * reading it as version 2; the pipeline's upcast and any stand-in for it read v1 through this.
 * Spec: modules/identity/specs/sso-connection-legacy-registration.feature
 */
import type { Named } from "@langwatch/module";
import { z } from "zod";

import {
  type ConnectionRegisteredPayloadSchema,
  DEFAULT_SSO_ARRIVAL_POLICY,
} from "./connection.ts";

/** The type every registration was stored under before version 2. */
export const CONNECTION_REGISTERED_V1_EVENT_TYPE = "lw.identity.connection_registered" as const;

/**
 * Version 1 as stored: rows from 2026-08-25 to 2026-09-21 carry a boolean `allowsJit` and no
 * `arrivalPolicy`; later rows carry the policy. FROZEN HISTORY: written in full, never derived
 * from current schemas, so a v2 field cannot fail a stored v1 row. Change only to match v1 rows.
 */
const connectionRegisteredV1PayloadSchemaDefinition = z.object({
  connectionId: z.string().min(1),
  organizationId: z.string().min(1),
  type: z.enum(["oidc", "saml"]),
  idp: z.object({
    issuer: z.string().min(1).nullable(),
    providerId: z.string().min(1),
    clientIdRef: z.string().min(1).nullable(),
    secretRef: z.string().min(1).nullable(),
    certRefs: z.array(z.string().min(1)),
  }),
  actor: z.object({
    type: z.enum(["user", "system"]),
    id: z.string().nullable(),
  }),
  source: z.enum(["self-serve", "legacy-grandfathered"]),
  arrivalPolicy: z.enum(["admit", "request", "refuse"]).nullish(),
  allowsJit: z.boolean().optional(),
});
export interface ConnectionRegisteredV1PayloadSchema extends Named<
  typeof connectionRegisteredV1PayloadSchemaDefinition
> {}
export const connectionRegisteredV1PayloadSchema: ConnectionRegisteredV1PayloadSchema =
  connectionRegisteredV1PayloadSchemaDefinition;

/**
 * A stored version 1 payload as version 2: the policy it states, else `admit` when it let
 * unknown people in, else the default. A policy outside the three answers is refused.
 */
export function registrationFromV1(stored: unknown): z.infer<ConnectionRegisteredPayloadSchema> {
  const { allowsJit, arrivalPolicy, ...rest } = connectionRegisteredV1PayloadSchema.parse(stored);
  return {
    ...rest,
    arrivalPolicy: arrivalPolicy ?? (allowsJit === true ? "admit" : DEFAULT_SSO_ARRIVAL_POLICY),
  };
}
