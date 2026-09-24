/**
 * The server half of `setupSkills.*`: the skill bodies are a compiled catalogue
 * Langy's setup-skills service holds.
 * Spec: specs/skills/empty-state-skill-setup.feature
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { LangyApi, setupSkillsTrpc } from "@langwatch/langy-contract";

export const setupSkillsTrpcTransport = defineTrpcRouter(LangyApi, setupSkillsTrpc)
  .procedure("getPrompt")
  .withPermission("project:view")
  .handle(({ app, input }) => app.getSetupSkillPrompt(input))
  .build();
