import {
  ANNOTATION_CREATED_EVENT_TYPE,
  ANNOTATION_DELETED_EVENT_TYPE,
  ANNOTATION_FACTS_EVENT_VERSION,
  ANNOTATION_SCORE_DEFINED_EVENT_TYPE,
  ANNOTATION_SCORE_RENAMED_EVENT_TYPE,
  ANNOTATION_UPDATED_EVENT_TYPE,
  type AnnotationContentEventData,
  annotationCreatedEventDataSchema,
  annotationDeletedEventDataSchema,
  annotationScoreDefinedEventDataSchema,
  annotationScoreRenamedEventDataSchema,
  annotationUpdatedEventDataSchema,
} from "@langwatch/annotation-contract";
import {
  createTenantId,
  defineAggregate,
  definePipeline,
  EventSourcing,
  InMemoryProcessStore,
} from "@langwatch/eventing";
import { EventStoreMemory, testEventSchema } from "@langwatch/eventing/testing";
import {
  TOPIC_CLUSTERING_EVENT_TYPES,
  TOPIC_CLUSTERING_EVENT_VERSIONS,
  type TopicClusteringTopicsRecordedEventData,
  topicClusteringTopicsRecordedEventDataSchema,
} from "@langwatch/topic-contract";

import { MemoryTraceAnnotationScoresRepository } from "../../repositories/memory/memory.trace-annotation-scores.repository.ts";
import { MemoryTraceAnnotationsRepository } from "../../repositories/memory/memory.trace-annotations.repository.ts";
import { MemoryTraceTopicNamesRepository } from "../../repositories/memory/memory.trace-topic-names.repository.ts";
import { buildTraceAnnotationsPipeline } from "../trace-annotations.pipeline.ts";
import { buildTraceTopicNamesPipeline } from "../trace-topic-names.pipeline.ts";

export const PROJECT = "project-1";

/** Topic's clustering pipeline as its contract names the model fact. */
export function topicStandIn() {
  return definePipeline({
    name: "topic_stand_in",
    aggregate: defineAggregate({ type: "topic_clustering" }),
  })
    .withEvents([
      testEventSchema(
        TOPIC_CLUSTERING_EVENT_TYPES.TOPICS_RECORDED,
        topicClusteringTopicsRecordedEventDataSchema,
      ),
    ])
    .build();
}

/** Annotation's lifecycle pipeline as its contract names the five facts. */
export function annotationStandIn() {
  return definePipeline({
    name: "annotation_stand_in",
    aggregate: defineAggregate({ type: "annotation" }),
  })
    .withEvents([
      testEventSchema(ANNOTATION_CREATED_EVENT_TYPE, annotationCreatedEventDataSchema),
      testEventSchema(ANNOTATION_UPDATED_EVENT_TYPE, annotationUpdatedEventDataSchema),
      testEventSchema(ANNOTATION_DELETED_EVENT_TYPE, annotationDeletedEventDataSchema),
      testEventSchema(ANNOTATION_SCORE_DEFINED_EVENT_TYPE, annotationScoreDefinedEventDataSchema),
      testEventSchema(ANNOTATION_SCORE_RENAMED_EVENT_TYPE, annotationScoreRenamedEventDataSchema),
    ])
    .build();
}

/** A topic entry as topic's fact carries it; only id, name and parent matter to trace. */
export function topicEntry(id: string, name: string, parentId: string | null = null) {
  return {
    id,
    name,
    parentId,
    embeddingsModel: "model",
    centroid: [0],
    p95Distance: 0,
    automaticallyGenerated: true,
  };
}

/** An annotation's content as annotation's created and updated facts carry it. */
export function annotationContent(
  overrides: Partial<AnnotationContentEventData> = {},
): AnnotationContentEventData {
  return {
    annotationId: "annotation-1",
    projectId: PROJECT,
    traceId: "trace-1",
    comment: "looks right",
    isThumbsUp: true,
    expectedOutput: null,
    scoreOptions: { "score-1": { value: "5" } },
    anchorKind: null,
    anchorId: null,
    anchorPath: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    occurredAt: 1_000,
    ...overrides,
  };
}

export function peerFoldsHarness() {
  const topicNames = MemoryTraceTopicNamesRepository.create();
  const annotations = MemoryTraceAnnotationsRepository.create();
  const scores = MemoryTraceAnnotationScoresRepository.create();
  const eventing = new EventSourcing({
    eventStore: EventStoreMemory.createForTesting(),
    processStore: InMemoryProcessStore.createForTesting(),
  });
  const topic = eventing.register(topicStandIn());
  const annotation = eventing.register(annotationStandIn());
  const topicHost = buildTraceTopicNamesPipeline(topicNames);
  const annotationHost = buildTraceAnnotationsPipeline({ annotations, scores });
  eventing.register(topicHost);
  eventing.register(annotationHost);
  const tenantId = createTenantId(PROJECT);

  const recordTopics = (id: string, data: TopicClusteringTopicsRecordedEventData, at: number) =>
    topic.service.storeEvents(
      [
        {
          id,
          aggregateId: PROJECT,
          aggregateType: "topic_clustering",
          tenantId,
          type: TOPIC_CLUSTERING_EVENT_TYPES.TOPICS_RECORDED,
          version: TOPIC_CLUSTERING_EVENT_VERSIONS.TOPICS_RECORDED,
          createdAt: at,
          occurredAt: at,
          data,
        },
      ],
      { tenantId },
    );

  const recordAnnotationFact = (
    id: string,
    fact: { type: string; aggregateId: string; data: { occurredAt: number } },
  ) =>
    annotation.service.storeEvents(
      [
        {
          id,
          aggregateId: fact.aggregateId,
          aggregateType: "annotation",
          tenantId,
          type: fact.type,
          version: ANNOTATION_FACTS_EVENT_VERSION,
          createdAt: fact.data.occurredAt,
          occurredAt: fact.data.occurredAt,
          data: fact.data,
        } as never,
      ],
      { tenantId },
    );

  return {
    eventing,
    topicHost,
    annotationHost,
    topicNames,
    annotations,
    scores,
    recordTopics,
    recordAnnotationFact,
  };
}
