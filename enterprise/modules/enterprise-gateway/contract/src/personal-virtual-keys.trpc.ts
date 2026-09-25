// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Every `personalVirtualKeys.*` procedure, declared once, at main's wire names. */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { enterpriseGatewayWriteAcknowledgedSchema } from "./enterprise-gateway.responses.ts";
import {
  issuedPersonalVirtualKeyAnswerSchema,
  personalVirtualKeySchema,
} from "./personal-virtual-key.ts";

const organizationScope = z.object({ organizationId: z.string() });

export const personalVirtualKeysTrpc = defineTrpcContract("personalVirtualKeys")
  .query("list")
  .withInput(z.object({ ...organizationScope.shape, targetUserId: z.string().optional() }))
  .withOutput(personalVirtualKeySchema.array())

  .mutation("issuePersonal")
  .withInput(
    z.object({
      ...organizationScope.shape,
      label: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-z0-9][a-z0-9_-]*$/, {
          message: "Label must be lowercase alphanumeric, dash, or underscore (no spaces)",
        }),
      routingPolicyId: z.string().optional(),
    }),
  )
  .withOutput(issuedPersonalVirtualKeyAnswerSchema)

  .mutation("revokePersonal")
  .withInput(z.object({ ...organizationScope.shape, id: z.string() }))
  .withOutput(enterpriseGatewayWriteAcknowledgedSchema)
  .build();
