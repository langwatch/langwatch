/**
 * langy_conversation_processing, registered by the module that owns it: the api sends its
 * commands, the worker folds the conversation, its turns, messages and analytics.
 */
import { defineEventingModule, type EventingSetup } from "@langwatch/eventing";

import type { LangyApp } from "../app/langy.app.ts";
import type { LangyRepositories } from "../repositories/langy-repositories.registry.ts";

export const langyConversationEventing = defineEventingModule({
  pipeline: "langy_conversation_processing",
  build: ({ app, participation }: EventingSetup<LangyRepositories, LangyApp>) =>
    app.conversationPipeline({ participation }),
  connect: ({ app, commands }) => app.connectConversationCommands(commands),
});
