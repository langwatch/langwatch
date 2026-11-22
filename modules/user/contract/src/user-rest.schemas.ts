import type { Named } from "@langwatch/module";
/**
 * The wire shapes user's REST doors publish. `/api/me/usage` is governance's
 * (its schemas live in governance's personal-usage.ts).
 */
import { z } from "zod";

/**
 * The identity of the project the calling API key belongs to. The CLI's
 * identity notice names the project behind LANGWATCH_API_KEY with it.
 */
const meProjectResponseSchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  isPersonal: z.boolean(),
});
export interface MeProjectResponseSchema extends Named<typeof meProjectResponseSchemaDefinition> {}
export const meProjectResponseSchema: MeProjectResponseSchema = meProjectResponseSchemaDefinition;

export type MeProject = z.infer<typeof meProjectResponseSchema>;

/** The path params the avatar byte door reads: whose avatar, in which project. */
const userAvatarRestParamsSchemaDefinition = z.object({
  projectId: z.string(),
  userAvatarId: z.string(),
});
export interface UserAvatarRestParamsSchema extends Named<
  typeof userAvatarRestParamsSchemaDefinition
> {}
export const userAvatarRestParamsSchema: UserAvatarRestParamsSchema =
  userAvatarRestParamsSchemaDefinition;

export type UserAvatarRestParams = z.infer<typeof userAvatarRestParamsSchema>;
