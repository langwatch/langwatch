import { bindRestCredential } from "@langwatch/api/rest";
import type { LangyApi, LangyServerConfig } from "@langwatch/langy-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";

import { LangyModule } from "./app/langy.app.ts";
import { langyChannels } from "./channels/langy-channels.registry.ts";
import { langyConversationEventing } from "./eventing/langy-conversation.pipeline.ts";
import { langyGuidedOnboardingEventing } from "./eventing/langy-guided-onboarding.pipeline.ts";
import { langyMaintenanceEventing } from "./eventing/langy-maintenance.pipeline.ts";
import { langyRepositories } from "./repositories/langy-repositories.registry.ts";
import { langyInternalRest } from "./transport/langy-internal.rest.ts";
import {
  langyLocalControlConnectDatedRests,
  langyLocalControlConnectRest,
  localControlSessionKeyDoor,
} from "./transport/langy-local-control-connect.rest.ts";
import {
  langyLocalControlDatedRests,
  langyLocalControlRest,
} from "./transport/langy-local-control.rest.ts";
import { createLangyLocalControlWebSocketProtocol } from "./transport/langy-local-control.ws.ts";
import { langyLocalRest } from "./transport/langy-local.rest.ts";
import { langyTurnsRest } from "./transport/langy-turns.rest.ts";
import { langyUiActionsRest } from "./transport/langy-ui-actions.rest.ts";
import { langyEgressTrpcTransport, langyTrpcTransport } from "./transport/langy.trpc.ts";
import { setupSkillsTrpcTransport } from "./transport/setup-skills.trpc.ts";

export const langyProcessModule: PublishedProcessModule<"langy", LangyApi, LangyServerConfig> =
  defineProcessModule("langy")
    .withRepositories(langyRepositories)
    .withChannels(langyChannels)
    .withApi(LangyModule)
    .withTransports(
      langyTurnsRest,
      langyUiActionsRest,
      langyInternalRest,
      langyLocalRest,
      langyLocalControlRest,
      langyLocalControlConnectRest,
      ...langyLocalControlDatedRests,
      ...langyLocalControlConnectDatedRests,
      createLangyLocalControlWebSocketProtocol(),
      setupSkillsTrpcTransport,
      langyTrpcTransport,
      langyEgressTrpcTransport,
    )
    .provideMiddlewareBindings(({ app }) => [
      bindRestCredential("internal_secret", () => app.internalDoor),
    ])
    .withDoors({ session_key: localControlSessionKeyDoor })
    .withEventing(langyConversationEventing)
    .withEventing(langyGuidedOnboardingEventing)
    .withEventing(langyMaintenanceEventing);
