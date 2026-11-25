import type { Named } from "@langwatch/module";
import { z } from "zod";

export const ADMIN_WORKSPACE_VIEW_ACTION = "governance.viewWorkspaceAs" as const;
export const ADMIN_WORKSPACE_VIEW_DEDUP_MS = 5 * 60 * 1_000;

export const adminWorkspaceKindSchema = z.enum(["personal", "team"]);
export type AdminWorkspaceKind = z.infer<typeof adminWorkspaceKindSchema>;

const workspaceViewerShape = {
  actorUserId: z.string().min(1),
  organizationId: z.string().min(1),
  workspaceLabel: z.string().optional(),
};

/** A personal or team workspace is a team; an aggregate project is the project itself (ADR-177). */
const recordWorkspaceViewInputSchemaDefinition = z.discriminatedUnion("kind", [
  z
    .object({
      ...workspaceViewerShape,
      kind: adminWorkspaceKindSchema,
      targetTeamId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      ...workspaceViewerShape,
      kind: z.literal("aggregate"),
      targetProjectId: z.string().min(1),
    })
    .strict(),
]);
export interface RecordWorkspaceViewInputSchema extends Named<
  typeof recordWorkspaceViewInputSchemaDefinition
> {}
export const recordWorkspaceViewInputSchema: RecordWorkspaceViewInputSchema =
  recordWorkspaceViewInputSchemaDefinition;
export type RecordWorkspaceViewInput = z.infer<typeof recordWorkspaceViewInputSchema>;

const recordWorkspaceViewResultSchemaDefinition = z
  .object({
    recorded: z.boolean(),
    auditLogId: z.string().min(1).nullable(),
  })
  .strict();
export interface RecordWorkspaceViewResultSchema extends Named<
  typeof recordWorkspaceViewResultSchemaDefinition
> {}
export const recordWorkspaceViewResultSchema: RecordWorkspaceViewResultSchema =
  recordWorkspaceViewResultSchemaDefinition;
export type RecordWorkspaceViewResult = z.infer<typeof recordWorkspaceViewResultSchema>;

export const GOVERNANCE_CALL_SURFACES = ["trpc", "hono", "cli", "mcp"] as const;
export const governanceCallSurfaceSchema = z.enum(GOVERNANCE_CALL_SURFACES);
export type GovernanceCallSurface = z.infer<typeof governanceCallSurfaceSchema>;
export const DEFAULT_GOVERNANCE_SURFACE: GovernanceCallSurface = "trpc";
