/** Contract schemas for the team feature's tRPC responses. */
import { z } from "zod";
import { organizationTeamWithMembersSchema } from "./team.ts";

/**
 * The project feature's own scalar value, mirrored since this package does
 * not depend on `@langwatch/project-contract`. Keep in step with
 * `projectSchema` in `modules/project/contract/src/project.ts`.
 */
const teamProjectSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    slug: z.string().min(1),
    apiKey: z.string(),
    lwqlKey: z.string(),
    teamId: z.string().min(1),
    language: z.string(),
    framework: z.string(),
    kind: z.string().min(1),
    firstMessage: z.boolean(),
    integrated: z.boolean(),
    createdAt: z.date(),
    updatedAt: z.date(),
    userLinkTemplate: z.string().nullable(),
    traceSharingEnabled: z.boolean(),
    presenceEnabled: z.boolean(),
    s3Endpoint: z.string().nullable(),
    s3AccessKeyId: z.string().nullable(),
    s3SecretAccessKey: z.string().nullable(),
    s3Bucket: z.string().nullable(),
    archivedAt: z.date().nullable(),
    isPersonal: z.boolean(),
    ownerUserId: z.string().nullable(),
    personalFeatures: z.json(),
    departmentId: z.string().nullable(),
    langyEgressAllowlist: z.json().nullable(),
    lastCodingAgentSessionAt: z.date().nullable(),
    lastCodingAgentPullRequestAt: z.date().nullable(),
  })
  .strict();

/** A team (or the organization's teams), each with its members and its projects. */
export const teamWithProjectsSchema = organizationTeamWithMembersSchema.extend({
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
