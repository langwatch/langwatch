import { NotFoundError } from "@langwatch/handled-error";
import { z } from "zod";
import {
  isSetupSkillId,
  setupPrompt,
} from "~/server/skills/setupSkills.service";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * Serves the setup instructions the empty states copy for a coding
 * agent. The bodies are 94 kB of markdown, so they stay on the server
 * and reach the browser only when a reader opens a setup menu.
 *
 * Spec: specs/skills/empty-state-skill-setup.feature
 */
export const setupSkillsRouter = createTRPCRouter({
  getPrompt: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        skill: z.string(),
        /** The freshly minted token, when the surface has one to pass on. */
        apiKey: z.string().optional(),
        endpoint: z.string().optional(),
      }),
    )
    .permission("project:view")
    .query(({ input }) => {
      if (!isSetupSkillId(input.skill)) {
        throw new NotFoundError("not_found", "Setup guide", input.skill);
      }
      return {
        prompt: setupPrompt({
          skill: input.skill,
          credentials: input.apiKey
            ? {
                apiKey: input.apiKey,
                projectId: input.projectId,
                endpoint: input.endpoint,
              }
            : undefined,
        }),
      };
    }),
});
