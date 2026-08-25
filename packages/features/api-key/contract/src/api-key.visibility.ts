import { z } from "zod";

export const apiKeyVisibleProjectsInputSchema = z
  .object({
    apiKeyId: z.string().min(1),
    organizationId: z.string().min(1),
  })
  .strict();
export type ApiKeyVisibleProjectsInput = z.infer<
  typeof apiKeyVisibleProjectsInputSchema
>;

export const apiKeyVisibleProjectsSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }).strict(),
  z
    .object({ kind: z.literal("some"), ids: z.array(z.string().min(1)) })
    .strict(),
]);
export type ApiKeyVisibleProjects = z.infer<
  typeof apiKeyVisibleProjectsSchema
>;
