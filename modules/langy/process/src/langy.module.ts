import { bindRestCredential } from "@langwatch/api/rest";
import { defineProcessModule } from "@langwatch/process";

import { LangyModule } from "./app/langy.app.ts";
import { langyConversationEventing } from "./eventing/langy-conversation.pipeline.ts";
import { langyMaintenanceEventing } from "./eventing/langy-maintenance.pipeline.ts";
import { langyRepositories } from "./repositories/langy-repositories.registry.ts";
import { langyInternalRest } from "./transport/langy-internal.rest.ts";
import {
  langyLocalControlConnectDatedRests,
  langyLocalControlConnectRest,
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

export const langyProcessModule = defineProcessModule("langy")
  .withRepositories(langyRepositories)
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
  .withTransportFacts(({ app }) => {
    if (!(app instanceof LangyModule))
      throw new TypeError("Langy transport requires its constructed application");
    return [
      bindRestCredential("internal_secret", () => app.internalDoor),
      bindRestCredential("session_key", () => app.sessionKeyDoor),
    ];
  })
  .withEventing(langyConversationEventing)
  .withEventing(langyMaintenanceEventing);
