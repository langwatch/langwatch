// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The CLI half of `personalSessions.*`, declared once, at main's wire names. */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { cliSessionCardSchema, cliSessionRevocationSchema } from "./cli-sessions.ts";

const organizationScope = z.object({ organizationId: z.string() });

export const personalSessionsTrpc = defineTrpcContract("personalSessions")
  .query("list")
  .withInput(organizationScope)
  .withOutput(cliSessionCardSchema.array())

  .mutation("revoke")
  .withInput(
    z.object({ ...organizationScope.shape, sessionStartedAtMs: z.number().int().nonnegative() }),
  )
  .withOutput(cliSessionRevocationSchema)

  .mutation("revokeAll")
  .withInput(organizationScope)
  .withOutput(cliSessionRevocationSchema)
  .build();
