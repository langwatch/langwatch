import { defineServerModule } from "@langwatch/runtime-composition";
import { LangyApp } from "./app/langy.app.ts";
import { langyRepositories } from "./repositories/langy-repositories.registry.ts";
import { langyTurnsRest } from "./transport/langy-turns.rest.ts";
import { setupSkillsTrpcTransport } from "./transport/setup-skills.trpc.ts";

export type { LangyInfrastructure } from "./app/langy.app.ts";

// `langy.*` and `langyEgress.*` still name the deleted tRPC builder and are
// not listed here yet; the UI-action, local and local-control REST families
// are unconverted too. See the langy lane's report for state.
export const langyServer = defineServerModule("langy")
  .withRepositories(langyRepositories)
  .withApp(LangyApp)
  .withTransports(langyTurnsRest, setupSkillsTrpcTransport)
  .build();
