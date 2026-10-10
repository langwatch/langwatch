import {
  controlRequestSchema,
  langyLocalWorkspaceStatusSchema,
  workspaceInfoSchema,
} from "@langwatch/langy-contract";
import { z } from "zod";

/**
 * `langy.getLocalWorkspace` as the panel reads it. The wire declares the folder and the open
 * request as loose records; they are the shared folder's `WorkspaceInfo` plus the machine it is
 * on, and the open control request, so they are read through those contract schemas here.
 */
const connectedWorkspaceSchema = z.object({ ...workspaceInfoSchema.shape, hostname: z.string() });

const langyLocalWorkspaceReadSchema = z.object({
  ...langyLocalWorkspaceStatusSchema.shape,
  workspace: connectedWorkspaceSchema.nullable(),
  pendingRequest: controlRequestSchema.nullable(),
});

export type LangyLocalWorkspaceRead = z.infer<typeof langyLocalWorkspaceReadSchema>;

export function parseLangyLocalWorkspace(value: unknown): LangyLocalWorkspaceRead {
  return langyLocalWorkspaceReadSchema.parse(value);
}
