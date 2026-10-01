import { z } from "zod";

export const ADMIN_WORKSPACE_VIEW_ACTION = "governance.viewWorkspaceAs" as const;
export const ADMIN_WORKSPACE_VIEW_DEDUP_MS = 5 * 60 * 1_000;

export const adminWorkspaceKindSchema = z.enum(["personal", "team"]);
export type AdminWorkspaceKind = z.infer<typeof adminWorkspaceKindSchema>;

export const recordWorkspaceViewInputSchema = z
  .object({
    actorUserId: z.string().min(1),
    organizationId: z.string().min(1),
    targetTeamId: z.string().min(1),
    kind: adminWorkspaceKindSchema,
    workspaceLabel: z.string().optional(),
  })
  .strict();
export type RecordWorkspaceViewInput = z.infer<typeof recordWorkspaceViewInputSchema>;

export const recordWorkspaceViewResultSchema = z
  .object({
    recorded: z.boolean(),
    auditLogId: z.string().min(1).nullable(),
  })
  .strict();
export type RecordWorkspaceViewResult = z.infer<typeof recordWorkspaceViewResultSchema>;
