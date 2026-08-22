import { NotFoundError } from "@langwatch/handled-error";
import { z } from "zod";
import {
  isSetupSkillId,
  setupSkillBody,
} from "~/server/skills/setupSkills.service";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * Serves the setup instructions the empty states copy for a coding
 * agent. The bodies are 94 kB of markdown, so they stay on the server
 * and reach the browser only when a reader opens a setup menu.
 *
 * The input carries no credentials: a tRPC query is a GET with its
 * input in the URL, and the browser already holds the minted token, so
 * it puts the keys above the body itself.
 *
 * Spec: specs/skills/empty-state-skill-setup.feature
 */
export const setupSkillsRouter = createTRPCRouter({
  getPrompt: protectedProcedure
    .input(z.object({ projectId: z.string(), skill: z.string() }))
    .permission("project:view")
    .query(({ input }) => {
      if (!isSetupSkillId(input.skill)) {
        throw new NotFoundError("not_found", "Setup guide", input.skill);
      }
      return { body: setupSkillBody(input.skill) };
    }),
});
