// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  SCIM_MEMBERSHIP_AGGREGATE_TYPE,
  SCIM_MEMBERSHIP_PIPELINE_NAME,
} from "@langwatch/enterprise-scim-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type ProcessStore,
} from "@langwatch/eventing";

import type { ScimModule } from "../app/scim.app.ts";
import type { ScimRepositories } from "../repositories/scim.repositories.ts";
import {
  SCIM_MEMBER_CREATED_INTENT,
  SCIM_MEMBERSHIP_PROCESS_NAME,
  SCIM_MEMBERSHIP_PRUNE_INTENT,
} from "../rules/scim-member-created.rules.ts";
import { RecordMemberCreatedCommand } from "./scim-member-created.commands.ts";
import {
  recordMemberCreatedCommandDataSchema,
  scimMemberCreatedEventSchema,
} from "./scim-member-created.events.ts";
import {
  pruneMemberCreatedIntents,
  recordMemberCreated,
  type ScimMemberCreatedSender,
} from "./scim-member-created.intent.ts";
import {
  SCIM_MEMBERSHIP_MAX_ATTEMPTS,
  SCIM_MEMBERSHIP_PROCESS_INITIAL_STATE,
  SCIM_MEMBERSHIP_PRUNE_INTERVAL_MS,
  scimMembershipProcessStateSchema,
  scimMembershipPruneSchema,
  scimMembershipPruneWake,
} from "./scim-member-created.process.ts";

type ScimMembershipDependencies = Readonly<{
  /** The member-created sender; it throws until this pipeline registers, so a delivery retries. */
  sender: () => ScimMemberCreatedSender;
  retention: Pick<ProcessStore, "deleteDispatchedBefore">;
}>;

function scimMembershipCommands({ sender, retention }: ScimMembershipDependencies) {
  return definePipeline({
    name: SCIM_MEMBERSHIP_PIPELINE_NAME,
    aggregate: defineAggregate({ type: SCIM_MEMBERSHIP_AGGREGATE_TYPE }),
  })
    .withEvents([scimMemberCreatedEventSchema])
    .withCommand("recordMemberCreated", RecordMemberCreatedCommand)
    .withProcessManager(SCIM_MEMBERSHIP_PROCESS_NAME, (pm) =>
      pm
        .state(scimMembershipProcessStateSchema, SCIM_MEMBERSHIP_PROCESS_INITIAL_STATE)
        .intent(
          SCIM_MEMBER_CREATED_INTENT,
          recordMemberCreatedCommandDataSchema,
          recordMemberCreated(sender),
        )
        .intent(
          SCIM_MEMBERSHIP_PRUNE_INTENT,
          scimMembershipPruneSchema,
          pruneMemberCreatedIntents(retention),
        )
        .schedule({ everyMs: SCIM_MEMBERSHIP_PRUNE_INTERVAL_MS })
        .onWake(scimMembershipPruneWake)
        .outbox({ maxAttempts: SCIM_MEMBERSHIP_MAX_ATTEMPTS }),
    );
}

export type ScimMembershipDefinition = ReturnType<
  ReturnType<typeof scimMembershipCommands>["build"]
>;

/**
 * scim_membership: the memberships a directory create wrote, recorded from the outbox the write
 * committed to, so organization counts each seat from its own side (organization ADR-002).
 */
export function buildScimMembershipPipeline(
  dependencies: ScimMembershipDependencies,
): ScimMembershipDefinition {
  return scimMembershipCommands(dependencies).build();
}

export const scimMembershipEventing = defineEventingModule({
  pipeline: SCIM_MEMBERSHIP_PIPELINE_NAME,
  build: ({ app, processStore }: EventingSetup<ScimRepositories, ScimModule>) =>
    app.membershipPipeline({ processStore }),
  connect: ({ app, commands }) => app.connectMembership(commands),
});
