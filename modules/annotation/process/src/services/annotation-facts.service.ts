import type { Annotation, AnnotationContentEventData } from "@langwatch/annotation-contract";
import type { EventingCommandSender } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type {
  RecordAnnotationCreatedCommandData,
  RecordAnnotationDeletedCommandData,
  RecordAnnotationUpdatedCommandData,
  RecordScoreDefinedCommandData,
  RecordScoreRenamedCommandData,
} from "../eventing/annotation-lifecycle.commands.ts";

type Sender<Data> = Pick<EventingCommandSender<Data>, "send">;

export type AnnotationLifecycleSenders = Readonly<{
  recordAnnotationCreated: Sender<RecordAnnotationCreatedCommandData>;
  recordAnnotationUpdated: Sender<RecordAnnotationUpdatedCommandData>;
  recordAnnotationDeleted: Sender<RecordAnnotationDeletedCommandData>;
  recordScoreDefined: Sender<RecordScoreDefinedCommandData>;
  recordScoreRenamed: Sender<RecordScoreRenamedCommandData>;
}>;

/**
 * Records annotation's facts on annotation_lifecycle; trace folds them from its own side (§9).
 * Awaited and loud, like organization's trace-sharing record: trace reads only what lands here.
 */
export class AnnotationFactsService {
  #senders: AnnotationLifecycleSenders | undefined;

  private constructor() {}

  static create(): AnnotationFactsService {
    return new AnnotationFactsService();
  }

  connect(senders: AnnotationLifecycleSenders): void {
    this.#senders = senders;
  }

  async annotationCreated(input: { annotation: Annotation; backfilled?: boolean }): Promise<void> {
    const content = this.#content(input.annotation);
    await this.#connected().recordAnnotationCreated.send({
      tenantId: input.annotation.projectId,
      ...content,
      ...(input.backfilled ? { backfilled: true } : {}),
    });
  }

  async annotationUpdated(input: { annotation: Annotation }): Promise<void> {
    await this.#connected().recordAnnotationUpdated.send({
      tenantId: input.annotation.projectId,
      ...this.#content(input.annotation),
    });
  }

  async annotationDeleted(input: { annotation: Annotation }): Promise<void> {
    const { id, projectId, traceId } = input.annotation;
    await this.#connected().recordAnnotationDeleted.send({
      tenantId: projectId,
      annotationId: id,
      projectId,
      traceId,
      occurredAt: nowInstant().epochMilliseconds,
    });
  }

  async scoreDefined(
    input: Readonly<{ scoreId: string; projectId: string; name: string; backfilled?: boolean }>,
  ): Promise<void> {
    await this.#connected().recordScoreDefined.send({
      tenantId: input.projectId,
      scoreId: input.scoreId,
      projectId: input.projectId,
      name: input.name,
      occurredAt: nowInstant().epochMilliseconds,
      ...(input.backfilled ? { backfilled: true } : {}),
    });
  }

  async scoreRenamed(
    input: Readonly<{ scoreId: string; projectId: string; name: string; previousName: string }>,
  ): Promise<void> {
    await this.#connected().recordScoreRenamed.send({
      tenantId: input.projectId,
      ...input,
      occurredAt: nowInstant().epochMilliseconds,
    });
  }

  #connected(): AnnotationLifecycleSenders {
    if (!this.#senders) throw new Error("annotation_lifecycle is not registered in this process");
    return this.#senders;
  }

  #content(annotation: Annotation): AnnotationContentEventData {
    return {
      annotationId: annotation.id,
      projectId: annotation.projectId,
      traceId: annotation.traceId,
      comment: annotation.comment,
      isThumbsUp: annotation.isThumbsUp,
      expectedOutput: annotation.expectedOutput,
      scoreOptions: annotation.scoreOptions,
      anchorKind: annotation.anchorKind,
      anchorId: annotation.anchorId,
      anchorPath: annotation.anchorPath,
      createdAt: annotation.createdAt.getTime(),
      updatedAt: annotation.updatedAt.getTime(),
      occurredAt: nowInstant().epochMilliseconds,
    };
  }
}
