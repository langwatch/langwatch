import { bindRestCredential } from "@langwatch/api/rest";
import type { ConnectApi } from "@langwatch/enterprise-connect-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";

import { ConnectModule } from "./app/connect.app.ts";
import { connectContractBudgetEventing } from "./eventing/connect-contract-budget.pipeline.ts";
import { connectHostedRest } from "./transport/connect-hosted.rest.ts";

export const connectProcessModule: PublishedProcessModule<"connect", ConnectApi, undefined> =
  defineProcessModule("connect")
    .withApi(ConnectModule)
    .withTransports(connectHostedRest)
    .withEventing(connectContractBudgetEventing)
    // The Go data plane signs hosted calls with the gateway's own secret, so the
    // family answers behind the gateway's door rather than a rebuilt one.
    .provideMiddlewareBindings(({ dependencies }) => [
      bindRestCredential("internal_secret", () => dependencies.gateway.internalDoor()),
    ]);
