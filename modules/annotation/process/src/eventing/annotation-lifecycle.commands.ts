import {
  ANNOTATION_CREATED_EVENT_TYPE,
  ANNOTATION_DELETED_EVENT_TYPE,
  ANNOTATION_FACTS_EVENT_VERSION,
  ANNOTATION_SCORE_DEFINED_EVENT_TYPE,
  ANNOTATION_SCORE_RENAMED_EVENT_TYPE,
  ANNOTATION_UPDATED_EVENT_TYPE,
  annotationCreatedEventDataSchema,
  annotationDeletedEventDataSchema,
  annotationScoreDefinedEventDataSchema,
  annotationScoreRenamedEventDataSchema,
  annotationUpdatedEventDataSchema,
} from "@langwatch/annotation-contract";
import type { Command, CommandHandler } from "@langwatch/eventing";
import {
  createTenantId,
  defineCommandSchema,
  EventSchema,
  EventUtils,
  stripEnvelope,
  withCommandEnvelope,
} from "@langwatch/eventing";
import { z } from "zod";

/** Annotation's own facts; trace folds them into its read model from its side (§9). */
export const ANNOTATION_LIFECYCLE_PIPELINE_NAME = "annotation_lifecycle" as const;
/** One aggregate per annotation, and per score definition, so each one's facts stay ordered. */
export const ANNOTATION_AGGREGATE_TYPE = "annotation" as const;

const RECORD_ANNOTATION_CREATED_COMMAND_TYPE = "lw.annotation.record_created" as const;
const RECORD_ANNOTATION_UPDATED_COMMAND_TYPE = "lw.annotation.record_updated" as const;
const RECORD_ANNOTATION_DELETED_COMMAND_TYPE = "lw.annotation.record_deleted" as const;
const RECORD_SCORE_DEFINED_COMMAND_TYPE = "lw.annotation.record_score_defined" as const;
const RECORD_SCORE_RENAMED_COMMAND_TYPE = "lw.annotation.record_score_renamed" as const;

const event = <Type extends string, Data extends z.ZodTypeAny>(type: Type, data: Data) =>
  z.object({
    ...EventSchema.shape,
    type: z.literal(type),
    version: z.literal(ANNOTATION_FACTS_EVENT_VERSION),
    data,
  });

export const annotationCreatedEventSchema = event(
  ANNOTATION_CREATED_EVENT_TYPE,
  annotationCreatedEventDataSchema,
);
export const annotationUpdatedEventSchema = event(
  ANNOTATION_UPDATED_EVENT_TYPE,
  annotationUpdatedEventDataSchema,
);
export const annotationDeletedEventSchema = event(
  ANNOTATION_DELETED_EVENT_TYPE,
  annotationDeletedEventDataSchema,
);
export const annotationScoreDefinedEventSchema = event(
  ANNOTATION_SCORE_DEFINED_EVENT_TYPE,
  annotationScoreDefinedEventDataSchema,
);
export const annotationScoreRenamedEventSchema = event(
  ANNOTATION_SCORE_RENAMED_EVENT_TYPE,
  annotationScoreRenamedEventDataSchema,
);
type AnnotationCreatedEvent = z.infer<typeof annotationCreatedEventSchema>;
type AnnotationUpdatedEvent = z.infer<typeof annotationUpdatedEventSchema>;
type AnnotationDeletedEvent = z.infer<typeof annotationDeletedEventSchema>;
type AnnotationScoreDefinedEvent = z.infer<typeof annotationScoreDefinedEventSchema>;
type AnnotationScoreRenamedEvent = z.infer<typeof annotationScoreRenamedEventSchema>;
export type AnnotationLifecycleEvent =
  | AnnotationCreatedEvent
  | AnnotationUpdatedEvent
  | AnnotationDeletedEvent
  | AnnotationScoreDefinedEvent
  | AnnotationScoreRenamedEvent;

const recordAnnotationCreatedCommandDataSchema = withCommandEnvelope(
  annotationCreatedEventDataSchema,
);
const recordAnnotationUpdatedCommandDataSchema = withCommandEnvelope(
  annotationUpdatedEventDataSchema,
);
const recordAnnotationDeletedCommandDataSchema = withCommandEnvelope(
  annotationDeletedEventDataSchema,
);
const recordScoreDefinedCommandDataSchema = withCommandEnvelope(
  annotationScoreDefinedEventDataSchema,
);
const recordScoreRenamedCommandDataSchema = withCommandEnvelope(
  annotationScoreRenamedEventDataSchema,
);
export type RecordAnnotationCreatedCommandData = z.infer<
  typeof recordAnnotationCreatedCommandDataSchema
>;
export type RecordAnnotationUpdatedCommandData = z.infer<
  typeof recordAnnotationUpdatedCommandDataSchema
>;
export type RecordAnnotationDeletedCommandData = z.infer<
  typeof recordAnnotationDeletedCommandDataSchema
>;
export type RecordScoreDefinedCommandData = z.infer<typeof recordScoreDefinedCommandDataSchema>;
export type RecordScoreRenamedCommandData = z.infer<typeof recordScoreRenamedCommandDataSchema>;

/**
 * Records a new annotation once; a backfilled one once per stored write, so a re-run of the
 * backfill records nothing and a row an old writer changed since is recorded again.
 */
export class RecordAnnotationCreatedCommand implements CommandHandler<
  Command<RecordAnnotationCreatedCommandData>,
  AnnotationCreatedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_ANNOTATION_CREATED_COMMAND_TYPE,
    recordAnnotationCreatedCommandDataSchema,
    "Record that an annotation was created",
  );

  handle(command: Command<RecordAnnotationCreatedCommandData>): AnnotationCreatedEvent[] {
    const data = stripEnvelope(command.data);
    return [
      EventUtils.createEvent<AnnotationCreatedEvent>({
        aggregateType: ANNOTATION_AGGREGATE_TYPE,
        aggregateId: data.annotationId,
        tenantId: createTenantId(command.tenantId),
        type: ANNOTATION_CREATED_EVENT_TYPE,
        version: ANNOTATION_FACTS_EVENT_VERSION,
        data: { ...data, occurredAt: command.data.occurredAt },
        occurredAt: command.data.occurredAt,
        idempotencyKey: data.backfilled
          ? `${data.annotationId}:backfilled:${data.updatedAt}`
          : `${data.annotationId}:created`,
      }),
    ];
  }

  static getAggregateId(payload: RecordAnnotationCreatedCommandData): string {
    return payload.annotationId;
  }
}

/** Records an annotation's content after a write, keyed on the write it records. */
export class RecordAnnotationUpdatedCommand implements CommandHandler<
  Command<RecordAnnotationUpdatedCommandData>,
  AnnotationUpdatedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_ANNOTATION_UPDATED_COMMAND_TYPE,
    recordAnnotationUpdatedCommandDataSchema,
    "Record that an annotation was updated",
  );

  handle(command: Command<RecordAnnotationUpdatedCommandData>): AnnotationUpdatedEvent[] {
    const data = stripEnvelope(command.data);
    return [
      EventUtils.createEvent<AnnotationUpdatedEvent>({
        aggregateType: ANNOTATION_AGGREGATE_TYPE,
        aggregateId: data.annotationId,
        tenantId: createTenantId(command.tenantId),
        type: ANNOTATION_UPDATED_EVENT_TYPE,
        version: ANNOTATION_FACTS_EVENT_VERSION,
        data: { ...data, occurredAt: command.data.occurredAt },
        occurredAt: command.data.occurredAt,
        idempotencyKey: `${data.annotationId}:updated:${data.updatedAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordAnnotationUpdatedCommandData): string {
    return payload.annotationId;
  }
}

/** Records an annotation's deletion; a row is deleted once, so one event. */
export class RecordAnnotationDeletedCommand implements CommandHandler<
  Command<RecordAnnotationDeletedCommandData>,
  AnnotationDeletedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_ANNOTATION_DELETED_COMMAND_TYPE,
    recordAnnotationDeletedCommandDataSchema,
    "Record that an annotation was deleted",
  );

  handle(command: Command<RecordAnnotationDeletedCommandData>): AnnotationDeletedEvent[] {
    const data = stripEnvelope(command.data);
    return [
      EventUtils.createEvent<AnnotationDeletedEvent>({
        aggregateType: ANNOTATION_AGGREGATE_TYPE,
        aggregateId: data.annotationId,
        tenantId: createTenantId(command.tenantId),
        type: ANNOTATION_DELETED_EVENT_TYPE,
        version: ANNOTATION_FACTS_EVENT_VERSION,
        data: { ...data, occurredAt: command.data.occurredAt },
        occurredAt: command.data.occurredAt,
        idempotencyKey: `${data.annotationId}:deleted`,
      }),
    ];
  }

  static getAggregateId(payload: RecordAnnotationDeletedCommandData): string {
    return payload.annotationId;
  }
}

/** Records a score definition's first name once; a backfilled one once per stored name. */
export class RecordScoreDefinedCommand implements CommandHandler<
  Command<RecordScoreDefinedCommandData>,
  AnnotationScoreDefinedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_SCORE_DEFINED_COMMAND_TYPE,
    recordScoreDefinedCommandDataSchema,
    "Record that an annotation score definition was created",
  );

  handle(command: Command<RecordScoreDefinedCommandData>): AnnotationScoreDefinedEvent[] {
    const data = stripEnvelope(command.data);
    return [
      EventUtils.createEvent<AnnotationScoreDefinedEvent>({
        aggregateType: ANNOTATION_AGGREGATE_TYPE,
        aggregateId: data.scoreId,
        tenantId: createTenantId(command.tenantId),
        type: ANNOTATION_SCORE_DEFINED_EVENT_TYPE,
        version: ANNOTATION_FACTS_EVENT_VERSION,
        data: { ...data, occurredAt: command.data.occurredAt },
        occurredAt: command.data.occurredAt,
        idempotencyKey: data.backfilled
          ? `${data.scoreId}:backfilled:${data.name}`
          : `${data.scoreId}:defined`,
      }),
    ];
  }

  static getAggregateId(payload: RecordScoreDefinedCommandData): string {
    return payload.scoreId;
  }
}

/** Records a score definition's new name, keyed on its moment. */
export class RecordScoreRenamedCommand implements CommandHandler<
  Command<RecordScoreRenamedCommandData>,
  AnnotationScoreRenamedEvent
> {
  static readonly schema = defineCommandSchema(
    RECORD_SCORE_RENAMED_COMMAND_TYPE,
    recordScoreRenamedCommandDataSchema,
    "Record that an annotation score definition was renamed",
  );

  handle(command: Command<RecordScoreRenamedCommandData>): AnnotationScoreRenamedEvent[] {
    const data = stripEnvelope(command.data);
    return [
      EventUtils.createEvent<AnnotationScoreRenamedEvent>({
        aggregateType: ANNOTATION_AGGREGATE_TYPE,
        aggregateId: data.scoreId,
        tenantId: createTenantId(command.tenantId),
        type: ANNOTATION_SCORE_RENAMED_EVENT_TYPE,
        version: ANNOTATION_FACTS_EVENT_VERSION,
        data: { ...data, occurredAt: command.data.occurredAt },
        occurredAt: command.data.occurredAt,
        idempotencyKey: `${data.scoreId}:renamed:${command.data.occurredAt}`,
      }),
    ];
  }

  static getAggregateId(payload: RecordScoreRenamedCommandData): string {
    return payload.scoreId;
  }
}
