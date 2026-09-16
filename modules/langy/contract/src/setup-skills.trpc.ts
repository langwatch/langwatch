/**
 * The `setupSkills.*` namespace: setup instructions the empty states copy
 * for a coding agent, kept server-side (~100 kB of markdown) until a reader opens the menu.
 * Spec: specs/skills/empty-state-skill-setup.feature
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

export const setupSkillsTrpc = defineTrpcContract("setupSkills")
  .query("getPrompt")
  .withInput(z.object({ projectId: z.string(), skill: z.string() }))
  .withOutput(z.object({ body: z.string() }).strict())
  .build();
