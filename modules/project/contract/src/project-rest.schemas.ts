import { z } from "zod";

export const projectRestPaginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(1000).optional().default(50),
});

export const projectRestCreateSchema = z
  .object({
    name: z.string().min(1, "name is required").max(255).describe("Project name"),
    teamId: z.string().min(1).optional().describe("Id of an existing team to put the project in"),
    newTeamName: z
      .string()
      .min(1)
      .max(255)
      .optional()
      .describe("Create a team with this name and put the project in it"),
    language: z
      .string()
      .min(1, "language is required")
      .describe("Programming language, such as python or typescript"),
    framework: z
      .string()
      .min(1, "framework is required")
      .describe("Framework in use, such as langchain or openai"),
  })
  .refine((data) => data.teamId || data.newTeamName, {
    message: "Either teamId or newTeamName must be provided",
  });

export const projectRestUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  language: z.string().optional(),
  framework: z.string().optional(),
  teamId: z.string().min(1).optional().describe("Moves the project to this team"),
});

export const projectRestParamsSchema = z.object({ id: z.string().min(1) });

/** Regenerating the key takes no body; an absent one is read as this. */
export const projectRestRegenerateApiKeyInputSchema = z.object({});

/**
 * The organization credential a management-door middleware resolves: the
 * key, and the member it acts as — null for a service key, which acts as
 * nobody.
 */
export const projectRestCredentialSchema = z.object({
  apiKeyId: z.string(),
  userId: z.string().nullable(),
});
