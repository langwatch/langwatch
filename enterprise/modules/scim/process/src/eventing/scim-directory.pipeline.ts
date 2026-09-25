// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
} from "@langwatch/eventing";

import type { ScimApp } from "../app/scim.app.ts";
import type { ScimRepositories } from "../repositories/scim.repositories.ts";
import type { ScimDirectoryMoveService } from "../services/scim-directory-move.service.ts";
import {
  RequestDirectoryMoveCommand,
  SCIM_DIRECTORY_AGGREGATE_TYPE,
  SCIM_DIRECTORY_MOVE_REQUESTED_EVENT_TYPE,
  SCIM_DIRECTORY_PIPELINE_NAME,
  scimDirectoryMoveRequestedEventSchema,
} from "./scim-directory-move.intent.ts";

function scimDirectoryCommands() {
  return definePipeline({
    name: SCIM_DIRECTORY_PIPELINE_NAME,
    aggregate: defineAggregate({ type: SCIM_DIRECTORY_AGGREGATE_TYPE }),
  })
    .withEvents([scimDirectoryMoveRequestedEventSchema])
    .withCommand("requestDirectoryMove", RequestDirectoryMoveCommand);
}

export type ScimDirectoryDefinition = ReturnType<ReturnType<typeof scimDirectoryCommands>["build"]>;

/** scim_directory: the api only records the request; the worker also moves the directory. */
export function buildScimDirectoryPipeline(input: {
  move?: Pick<ScimDirectoryMoveService, "moveToConnection">;
}): ScimDirectoryDefinition {
  const move = input.move;
  if (!move) return scimDirectoryCommands().build();
  return scimDirectoryCommands()
    .withEventSubscriber("moveDirectory", {
      events: [SCIM_DIRECTORY_MOVE_REQUESTED_EVENT_TYPE],
      handler: async (event) => {
        await move.moveToConnection({
          organizationId: event.data.organizationId,
          fromConnectionId: event.data.fromConnectionId,
          toConnectionId: event.data.toConnectionId,
        });
      },
    })
    .build();
}

export const scimDirectoryEventing = defineEventingModule({
  pipeline: SCIM_DIRECTORY_PIPELINE_NAME,
  build: ({ app, participation }: EventingSetup<ScimRepositories, ScimApp>) =>
    app.directoryPipeline({ participation }),
  connect: ({ app, commands }) => app.connectDirectory(commands),
});
