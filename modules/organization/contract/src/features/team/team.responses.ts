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
export const teamWithProjectsSchema = organizationTeamWithMembersSchema.safeExtend({
  projects: z.array(teamProjectSchema),
});
export type TeamWithProjects = z.infer<typeof teamWithProjectsSchema>;

/** A write with nothing else to report. */
export const teamWriteAckSchema = z.object({ success: z.literal(true) }).strict();
export type TeamWriteAck = z.infer<typeof teamWriteAckSchema>;

/** A member was removed; the caller reads back who. */
export const teamMemberRemovedSchema = z
  .object({ success: z.literal(true), removedUserId: z.string().min(1) })
  .strict();
export type TeamMemberRemoved = z.infer<typeof teamMemberRemovedSchema>;
