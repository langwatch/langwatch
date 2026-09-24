// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Every `governance.*` procedure served so far, declared once, at main's wire names. */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { governanceActorWorkspaceSchema } from "./governance.responses.ts";

export const governanceTrpc = defineTrpcContract("governance")
  /** An actor stamped on spans (email or user id) to their personal workspace here, or null. */
  .query("resolveActorPersonalProject")
  .withInput(z.object({ organizationId: z.string(), actor: z.string().min(1).max(512) }))
  .withOutput(governanceActorWorkspaceSchema.nullable())
  .build();
