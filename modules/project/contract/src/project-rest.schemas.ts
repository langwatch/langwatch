import { dataPrivacyPiiRedactionLevelSchema } from "@langwatch/data-privacy-contract";
import { z } from "zod";

export const projectRestUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  language: z.string().optional(),
  framework: z.string().optional(),
  teamId: z.string().min(1).optional().describe("Moves the project to this team"),
  piiRedactionLevel: dataPrivacyPiiRedactionLevelSchema
    .optional()
    .describe("The PII level the project's traces are redacted at"),
});

export const projectRestParamsSchema = z.object({ id: z.string().min(1) });

/** Regenerating the key takes no body; an absent one is read as this. */
export const projectRestRegenerateApiKeyInputSchema = z.object({});
