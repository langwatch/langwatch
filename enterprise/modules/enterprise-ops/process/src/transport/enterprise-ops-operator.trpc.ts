// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Gated like Cloud admin: the platform-operator grant asked at the door, never org RBAC. */
import { defineTrpcFact } from "@langwatch/api/trpc";
import { opsOperatorSchema } from "@langwatch/ops-contract";

/** The signed-in operator, bound by the process under the name ops reads it by. */
export const operatorFact = defineTrpcFact("opsOperator", opsOperatorSchema.nullable());

/** Cloud admin staff hold ops:view at the platform; anyone else is answered not-found (Q42). */
export const STAFF = { at: "platform", hiddenWithout: "ops:view" } as const;
