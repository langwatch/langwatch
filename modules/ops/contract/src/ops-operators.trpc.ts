/**
 * The Operators page: list, grant and revoke the platform-operator role. Every
 * procedure needs `ops:manage`; authz decides the self-grant and last-holder rules.
 */
import { defineTrpcContract } from "@langwatch/kernel/contract";
import { z } from "zod";

import { opsOkOutputSchema } from "./ops-feature-flag.ts";
import {
  opsGrantPlatformOperatorInputSchema,
  opsPlatformOperatorListSchema,
  opsPlatformOperatorSchema,
  opsRevokePlatformOperatorInputSchema,
} from "./ops-operators.ts";

export const opsOperatorsTrpc = defineTrpcContract("ops")
  .query("listPlatformOperators")
  .withInput(z.void())
  .withOutput(opsPlatformOperatorListSchema)

  .mutation("grantPlatformOperator")
  .withInput(opsGrantPlatformOperatorInputSchema)
  .withOutput(opsPlatformOperatorSchema)

  .mutation("revokePlatformOperator")
  .withInput(opsRevokePlatformOperatorInputSchema)
  .withOutput(opsOkOutputSchema)
  .build();
