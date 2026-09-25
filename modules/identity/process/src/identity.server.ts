import { bindTrpcFact, type TrpcRuntimeContext } from "@langwatch/api/trpc";
import { defineServerModule } from "@langwatch/kernel";

import { IdentityApp } from "./app/identity.app.ts";
import { identityEventing } from "./eventing/identity.pipeline.ts";
import { joinRequestEventing } from "./eventing/join-request.pipeline.ts";
import { scimSyncEventing } from "./eventing/scim-sync.pipeline.ts";
import { ssoConnectionEventing } from "./eventing/sso-connection.pipeline.ts";
import { identityPipelineEventing } from "./eventing/user-identity.pipeline.ts";
import { identityRepositories } from "./repositories/identity-repositories.registry.ts";
import { identityLookupTrpcTransport } from "./transport/identity-lookup.trpc.ts";
import { identityTrpcTransport } from "./transport/identity.trpc.ts";
import {
  twoStepRequestHeadersFact,
  twoStepVerificationTrpcTransport,
} from "./transport/two-step-verification.trpc.ts";

export const identityServer = defineServerModule("identity")
  .withRepositories(identityRepositories)
  .withApp(IdentityApp)
  .withTransports(
    identityLookupTrpcTransport,
    identityTrpcTransport,
    twoStepVerificationTrpcTransport,
  )
  .withTransportFacts(() => [
    bindTrpcFact(
      twoStepRequestHeadersFact,
      (context: TrpcRuntimeContext) => context.req?.headers ?? null,
    ),
  ])
  .withEventing(identityEventing)
  .withEventing(identityPipelineEventing)
  .withEventing(joinRequestEventing)
  .withEventing(scimSyncEventing)
  .withEventing(ssoConnectionEventing);
