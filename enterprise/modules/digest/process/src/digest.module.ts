// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { callerAddressOfRequest } from "@langwatch/api/rest";
import type { DigestApi, DigestServerConfig } from "@langwatch/enterprise-digest-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";

import { DigestModule } from "./app/digest.app.ts";
import { digestChannels } from "./channels/digest-channels.registry.ts";
import { digestSendEventing } from "./eventing/digest-send.pipeline.ts";
import { digestEventing } from "./eventing/digest.pipeline.ts";
import { digestRepositories } from "./repositories/digest-repositories.registry.ts";
import { digestUnsubscribeRest } from "./transport/digest-unsubscribe.rest.ts";
import { digestTrpcTransport } from "./transport/digest.trpc.ts";

export const digestProcessModule: PublishedProcessModule<"digest", DigestApi, DigestServerConfig> =
  defineProcessModule("digest")
    .withRepositories(digestRepositories)
    .withChannels(digestChannels)
    .withApi(DigestModule)
    .withTransports(digestTrpcTransport, digestUnsubscribeRest)
    // The unsubscribe throttle counts each caller by the address the door resolved.
    .provideMiddlewareContext({ callerAddress: callerAddressOfRequest })
    .withEventing(digestEventing)
    .withEventing(digestSendEventing);
