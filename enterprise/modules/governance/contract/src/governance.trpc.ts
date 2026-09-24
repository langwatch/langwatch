// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Every `governance.*` procedure served so far, declared once, at main's wire names. */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  adminWorkspaceKindSchema,
  recordWorkspaceViewResultSchema,
} from "./admin-workspace-view-audit.ts";
import { governanceActorWorkspaceSchema } from "./governance.responses.ts";
import { governanceSetupStateSchema } from "./governance.ts";
import { governanceOcsfExportPageSchema } from "./ocsf-export.ts";
import {
  QUARANTINE_DEFAULT_THRESHOLD,
  QUARANTINE_DEFAULT_WINDOW_SECONDS,
  quarantineFillStatsSchema,
} from "./quarantine-fill.ts";

const organizationScope = z.object({ organizationId: z.string() });

export const governanceTrpc = defineTrpcContract("governance")
  /** An actor stamped on spans (email or user id) to their personal workspace here, or null. */
  .query("resolveActorPersonalProject")
  .withInput(z.object({ organizationId: z.string(), actor: z.string().min(1).max(512) }))
  .withOutput(governanceActorWorkspaceSchema.nullable())

  /** The persona-detection signal: whether this organization has any governance state. */
  .query("setupState")
  .withInput(organizationScope)
  .withOutput(governanceSetupStateSchema)

  /** One page of the organization's OCSF events, after the (sinceMs, sinceEventId) watermark. */
  .query("ocsfExport")
  .withInput(
    z.object({
      ...organizationScope.shape,
      sinceMs: z.number().int().nonnegative().optional(),
      sinceEventId: z.string().optional(),
      limit: z.number().int().min(1).max(1000).default(500),
    }),
  )
  .withOutput(governanceOcsfExportPageSchema)

  /** The quarantine-fill rate of the organization's hidden governance project. */
  .query("quarantineFillStats")
  .withInput(
    z.object({
      ...organizationScope.shape,
      windowSeconds: z.number().int().min(10).max(3600).default(QUARANTINE_DEFAULT_WINDOW_SECONDS),
      threshold: z.number().int().min(1).default(QUARANTINE_DEFAULT_THRESHOLD),
    }),
  )
  .withOutput(quarantineFillStatsSchema)

  /** Records an admin's drill-in into another's workspace; deduplicated within five minutes. */
  .mutation("recordWorkspaceView")
  .withInput(
    z.object({
      ...organizationScope.shape,
      targetTeamId: z.string(),
      kind: adminWorkspaceKindSchema,
      workspaceLabel: z.string().max(256).optional(),
    }),
  )
  .withOutput(recordWorkspaceViewResultSchema)
  .build();
