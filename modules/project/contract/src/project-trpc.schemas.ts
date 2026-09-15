/**
 * What the project's three tRPC namespaces accept, stated once. These parsers
 * are the wire contract the browser has always sent: same fields, same
 * defaults, same refusals.
 */
import { z } from "zod";

/** The project a procedure acts on, and the only field most of them take. */
export const projectScopeSchema = z.object({ projectId: z.string() });
export type ProjectScopeInput = z.infer<typeof projectScopeSchema>;

/**
 * A project is provisioned into an existing team, or into a team created
 * alongside it. Which of the two is asked for decides the scope the caller's
 * standing is resolved at, so both fields stay optional here.
 */
export const projectCreateInputSchema = z.object({
  organizationId: z.string(),
  teamId: z.string().optional(),
  newTeamName: z.string().optional(),
  name: z.string(),
  language: z.string(),
  framework: z.string(),
});
export type ProjectCreateInput = z.infer<typeof projectCreateInputSchema>;

/**
 * The settings form. The stored-object credentials are all-or-nothing: a
 * half-filled set would persist an endpoint the project cannot actually reach.
 */
export const projectUpdateInputSchema = z
  .object({
    projectId: z.string(),
    name: z.string().optional(),
    language: z.string().optional(),
    framework: z.string().optional(),
    teamId: z.string().optional(),
    traceSharingEnabled: z.boolean().optional(),
    presenceEnabled: z.boolean().optional(),
    userLinkTemplate: z.string().optional(),
    s3Endpoint: z.string().optional(),
    s3AccessKeyId: z.string().optional(),
    s3SecretAccessKey: z.string().optional(),
    s3Bucket: z.string().optional(),
  })
  .refine((data) => {
    const hasEndpoint = !!data.s3Endpoint?.trim();
    const hasAccessKey = !!data.s3AccessKeyId?.trim();
    const hasSecretKey = !!data.s3SecretAccessKey?.trim();

    return (
      (hasEndpoint && hasAccessKey && hasSecretKey) ||
      (!hasEndpoint && !hasAccessKey && !hasSecretKey)
    );
  });
export type ProjectUpdateInput = z.infer<typeof projectUpdateInputSchema>;

/** Two projects: the one the caller is in, and the one being archived. */
export const projectArchiveByIdInputSchema = z.object({
  projectId: z.string(),
  projectToArchiveId: z.string(),
});
export type ProjectArchiveByIdInput = z.infer<typeof projectArchiveByIdInputSchema>;

/** The recent-items strip: one project, and how many rows it renders. */
export const recentItemsInputSchema = z.object({
  projectId: z.string(),
  limit: z.number().min(1).max(50).default(12),
});
export type RecentItemsInput = z.infer<typeof recentItemsInputSchema>;
