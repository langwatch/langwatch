import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
} from "@langwatch/eventing";

import type { AuthzModule } from "../app/authz.app.ts";
import type { AuthzRepositories } from "../repositories/authz.repositories.ts";
import { RecordMemberOffboardedCommand } from "./authz-member-offboarded.commands.ts";
import {
  AUTHZ_MEMBER_OFFBOARDED_AGGREGATE_TYPE,
  AUTHZ_MEMBER_OFFBOARDED_PIPELINE_NAME,
  authzMemberOffboardedEventSchema,
} from "./authz-member-offboarded.events.ts";

function memberOffboardedCommands() {
  return definePipeline({
    name: AUTHZ_MEMBER_OFFBOARDED_PIPELINE_NAME,
    aggregate: defineAggregate({ type: AUTHZ_MEMBER_OFFBOARDED_AGGREGATE_TYPE }),
  })
    .withEvents([authzMemberOffboardedEventSchema])
    .withCommand("recordMemberOffboarded", RecordMemberOffboardedCommand);
}

export type AuthzMemberOffboardedDefinition = ReturnType<
  ReturnType<typeof memberOffboardedCommands>["build"]
>;

/** authz_member_offboarded: authz records the fact, organization records the removal (§9). */
export function buildAuthzMemberOffboardedPipeline(): AuthzMemberOffboardedDefinition {
  return memberOffboardedCommands().build();
}

export const authzMemberOffboardedEventing = defineEventingModule({
  pipeline: AUTHZ_MEMBER_OFFBOARDED_PIPELINE_NAME,
  build: ({ app }: EventingSetup<AuthzRepositories, AuthzModule>) => app.memberOffboardedPipeline(),
  connect: ({ app, commands }) => app.connectMemberOffboarded(commands),
});
