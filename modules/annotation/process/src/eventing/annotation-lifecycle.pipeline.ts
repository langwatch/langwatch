import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
} from "@langwatch/eventing";

import type { AnnotationModule } from "../app/annotation.app.ts";
import type { AnnotationRepositories } from "../repositories/annotation.repositories.ts";
import {
  ANNOTATION_AGGREGATE_TYPE,
  ANNOTATION_LIFECYCLE_PIPELINE_NAME,
  annotationCreatedEventSchema,
  annotationDeletedEventSchema,
  annotationScoreDefinedEventSchema,
  annotationScoreRenamedEventSchema,
  annotationUpdatedEventSchema,
  RecordAnnotationCreatedCommand,
  RecordAnnotationDeletedCommand,
  RecordAnnotationUpdatedCommand,
  RecordScoreDefinedCommand,
  RecordScoreRenamedCommand,
} from "./annotation-lifecycle.commands.ts";

function lifecycleCommands() {
  return definePipeline({
    name: ANNOTATION_LIFECYCLE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: ANNOTATION_AGGREGATE_TYPE }),
  })
    .withEvents([
      annotationCreatedEventSchema,
      annotationUpdatedEventSchema,
      annotationDeletedEventSchema,
      annotationScoreDefinedEventSchema,
      annotationScoreRenamedEventSchema,
    ])
    .withCommand("recordAnnotationCreated", RecordAnnotationCreatedCommand)
    .withCommand("recordAnnotationUpdated", RecordAnnotationUpdatedCommand)
    .withCommand("recordAnnotationDeleted", RecordAnnotationDeletedCommand)
    .withCommand("recordScoreDefined", RecordScoreDefinedCommand)
    .withCommand("recordScoreRenamed", RecordScoreRenamedCommand);
}

export type AnnotationLifecyclePipeline = ReturnType<ReturnType<typeof lifecycleCommands>["build"]>;

/** annotation_lifecycle records; trace folds the facts from its own side (§9, round 24 EF-1). */
export function buildAnnotationLifecyclePipeline(): AnnotationLifecyclePipeline {
  return lifecycleCommands().build();
}

export const annotationLifecycleEventing = defineEventingModule({
  pipeline: ANNOTATION_LIFECYCLE_PIPELINE_NAME,
  build: ({ app }: EventingSetup<AnnotationRepositories, AnnotationModule>) =>
    app.lifecyclePipeline(),
  connect: ({ app, commands }) => app.connectLifecycleCommands(commands),
});
