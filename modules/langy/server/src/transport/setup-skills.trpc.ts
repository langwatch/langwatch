/**
 * The server half of `setupSkills.*`. Reads nothing off Langy's own
 * application: the skill bodies are a compiled catalogue the package holds.
 * Spec: specs/skills/empty-state-skill-setup.feature
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { LangyApi, setupSkillsTrpc } from "@langwatch/langy-contract";
import { NotFoundError } from "@langwatch/handled-error";

import { SetupSkillsService } from "../services/setup-skills.service.ts";

export const setupSkillsTrpcTransport = defineTrpcRouter(LangyApi, setupSkillsTrpc)
  .procedure("getPrompt")
  .withPermission("project:view")
  .handle(({ input }) => {
    const skills = SetupSkillsService.create();
    if (!skills.isSetupSkillId(input.skill)) {
      throw new NotFoundError("not_found", "Setup guide", input.skill);
    }
    return { body: skills.body(input.skill) };
  })
  .build();
