import { defineModule } from "@langwatch/runtime-composition";
import { LangyApp } from "./app/langy.app.ts";
import { setupSkillsTrpcTransport } from "./transport/setup-skills.trpc.ts";

export type { LangyInfrastructure } from "./app/langy.app.ts";

// `langy.*` and `langyEgress.*` still name the deleted tRPC builder and are
// not listed here yet; the eight REST families and the local-control
// WebSocket transport are unconverted too. See
// dev/docs/plans/lane-brief.md and the langy lane's report for state.
export const langyServer = defineModule("langy")
  .withApp(LangyApp)
  .withTransports(setupSkillsTrpcTransport)
  .build();
