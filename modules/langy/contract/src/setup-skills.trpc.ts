/**
 * The `setupSkills.*` namespace: the setup instructions the empty states copy
 * for a coding agent. The bodies are ~100 kB of markdown, so they stay on the
 * server and reach the browser only when a reader opens a setup menu.
 * Spec: specs/skills/empty-state-skill-setup.feature
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

export const setupSkillsTrpc = defineTrpcContract("setupSkills")
  .query("getPrompt")
  .withInput(z.object({ projectId: z.string(), skill: z.string() }))
  .withOutput(z.object({ body: z.string() }).strict())
  .build();
