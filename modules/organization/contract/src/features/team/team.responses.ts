import type { Named } from "@langwatch/module";
/** Contract schemas for the team feature's tRPC responses. */
import { z } from "zod";

import { organizationTeamWithMembersSchema } from "./team.ts";

/** The project fields a team picker and a team page read: no keys, no storage settings. */
const teamProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  slug: z.string().min(1),
});

/** A team (or the organization's teams), each with its members and its projects. */
const teamWithProjectsSchemaDefinition = organizationTeamWithMembersSchema.safeExtend({
  projects: z.array(teamProjectSchema),
});
export interface TeamWithProjectsSchema extends Named<typeof teamWithProjectsSchemaDefinition> {}
export const teamWithProjectsSchema: TeamWithProjectsSchema = teamWithProjectsSchemaDefinition;
export type TeamWithProjects = z.infer<typeof teamWithProjectsSchema>;

/** A write with nothing else to report. */
const teamWriteAckSchemaDefinition = z.object({ success: z.literal(true) }).strict();
export interface TeamWriteAckSchema extends Named<typeof teamWriteAckSchemaDefinition> {}
export const teamWriteAckSchema: TeamWriteAckSchema = teamWriteAckSchemaDefinition;
export type TeamWriteAck = z.infer<typeof teamWriteAckSchema>;

/** A member was removed; the caller reads back who. */
const teamMemberRemovedSchemaDefinition = z
  .object({ success: z.literal(true), removedUserId: z.string().min(1) })
  .strict();
export interface TeamMemberRemovedSchema extends Named<typeof teamMemberRemovedSchemaDefinition> {}
export const teamMemberRemovedSchema: TeamMemberRemovedSchema = teamMemberRemovedSchemaDefinition;
export type TeamMemberRemoved = z.infer<typeof teamMemberRemovedSchema>;
