// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { SsoSignInProviderRecordedEventData } from "@langwatch/enterprise-sso-contract";
import { SSO_SIGN_IN_PROVIDER_AGGREGATE_TYPE } from "@langwatch/enterprise-sso-contract";
import {
  type CommandEnvelope,
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { SsoModule } from "../app/sso.app.ts";
import {
  RecordSsoSignInProviderCommand,
  type SsoSignInProviderRecordedEvent,
  ssoSignInProviderRecordedEventSchema,
} from "./sso-sign-in-provider.commands.ts";

const SSO_SIGN_IN_PROVIDER_PIPELINE_NAME = "sso_sign_in_provider";

export type SsoSignInProviderPipeline = StaticPipelineDefinition<
  SsoSignInProviderRecordedEvent,
  Record<string, Projection>,
  {
    name: "recordSignInProvider";
    payload: SsoSignInProviderRecordedEventData & CommandEnvelope;
  }
>;

/** sso_sign_in_provider: which provider this deployment mounted; licensing applies it (ADR-179). */
export function buildSsoSignInProviderPipeline(): SsoSignInProviderPipeline {
  return definePipeline({
    name: SSO_SIGN_IN_PROVIDER_PIPELINE_NAME,
    aggregate: defineAggregate({ type: SSO_SIGN_IN_PROVIDER_AGGREGATE_TYPE }),
  })
    .withEvents([ssoSignInProviderRecordedEventSchema])
    .withCommand("recordSignInProvider", RecordSsoSignInProviderCommand)
    .build();
}

export const ssoSignInProviderEventing = defineEventingModule({
  pipeline: SSO_SIGN_IN_PROVIDER_PIPELINE_NAME,
  build: (_setup: EventingSetup<never, SsoModule>) => buildSsoSignInProviderPipeline(),
  connect: ({ app, commands }) => app.connectSignInProviderCommands(commands),
});
