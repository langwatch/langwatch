// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Every `governance.*` procedure served so far, declared once, at main's wire names. */
import { defineTrpcContract } from "@langwatch/module";
import { PROJECT_CREATED_EVENT_TYPE } from "@langwatch/project-contract";
import { z } from "zod";

import {
  adminWorkspaceKindSchema,
  recordWorkspaceViewResultSchema,
} from "./admin-workspace-view-audit.ts";
import { cliBootstrapResultSchema } from "./features/cli/cli-bootstrap.ts";
import {
  QUARANTINE_DEFAULT_THRESHOLD,
  QUARANTINE_DEFAULT_WINDOW_SECONDS,
  quarantineFillStatsSchema,
} from "./features/ingestion/quarantine-fill.ts";
import { personaResolutionSchema } from "./features/personal/persona-home.ts";
import { governanceBudgetOverviewForUserSchema } from "./features/personal/personal-budget-overview.ts";
import { personalUsageRollupSchema } from "./features/personal/personal-usage.ts";
import { governanceActorWorkspaceSchema } from "./governance.responses.ts";
import { governanceSetupStateSchema } from "./governance.ts";
import { governanceOcsfExportPageSchema } from "./ocsf-export.ts";

const organizationScope = z.object({ organizationId: z.string() });

export const governanceTrpc = defineTrpcContract("governance")
  /** An actor stamped on spans (email or user id) to their personal workspace here, or null. */
  .query("resolveActorPersonalProject", {
    invalidatedBy: [{ event: PROJECT_CREATED_EVENT_TYPE, scope: "organizationId" }],
  })
  .withInput(z.object({ organizationId: z.string(), actor: z.string().min(1).max(512) }))
  .withOutput(governanceActorWorkspaceSchema.nullable())

  /** Where the caller lands in this organization: main's persona home. */
  .query("resolveHome")
  .withInput(organizationScope)
  .withOutput(personaResolutionSchema)

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

  /** The caller's own /me rollup; the window applies only when both ends are given. */
  .query("personalUsage")
  .withInput(
    z.object({
      ...organizationScope.shape,
      windowStartMs: z.number().optional(),
      windowEndMs: z.number().optional(),
    }),
  )
  .withOutput(personalUsageRollupSchema)

  /** Every budget binding the caller's own keys, most binding first. */
  .query("budgetOverview")
  .withInput(z.object({ ...organizationScope.shape, includeTopModels: z.boolean().optional() }))
  .withOutput(governanceBudgetOverviewForUserSchema)

  /** What the CLI's login ceremony renders: the caller's providers and monthly budget. */
  .query("cliBootstrap")
  .withInput(organizationScope)
  .withOutput(cliBootstrapResultSchema)
  .build();
