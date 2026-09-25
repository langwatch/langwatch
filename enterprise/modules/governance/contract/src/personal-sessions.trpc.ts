// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** `personalSessions.*`, the CLI devices and the web sessions, declared once, at main's wire names. */
import { defineTrpcContract } from "@langwatch/api/contract";
import { browserSessionInventoryEntrySchema } from "@langwatch/auth-contract";
import { z } from "zod";

import { cliSessionCardSchema, cliSessionRevocationSchema } from "./cli-sessions.ts";

const organizationScope = z.object({ organizationId: z.string() });
const webSessionsEnded = z.object({ ended: z.number().int().nonnegative() });

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

  .query("listWebSessions")
  .withInput(z.object({}))
  .withOutput(browserSessionInventoryEntrySchema.array())

  .mutation("revokeWebSession")
  .withInput(z.object({ sessionId: z.string().min(1) }))
  .withOutput(webSessionsEnded)

  .mutation("revokeWebSessionsForIdentifier")
  .withInput(z.object({ identifierId: z.string().min(1) }))
  .withOutput(webSessionsEnded)
  .build();
