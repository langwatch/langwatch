// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Gated like the back office: the platform-operator grant checked by the application, never org RBAC. */
import { defineTrpcFact } from "@langwatch/api/trpc";
import { opsOperatorSchema } from "@langwatch/ops-contract";

/** The signed-in operator, bound by the process under the name ops reads it by. */
export const operatorFact = defineTrpcFact("opsOperator", opsOperatorSchema.nullable());

export const STAFF_LIST = {
  reason:
    "back-office surface gated on the platform-operator grant (ops:* at the platform tier), not on an org RBAC permission; cross-tenant by design",
} as const;

export const STAFF_LIST_FOR_ORGANIZATION = {
  ...STAFF_LIST,
  allow: {
    organizationId:
      "names the customer organization a license is linked to; the caller's reach is the platform-operator grant and is never derived from this id",
  },
} as const;
