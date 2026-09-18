import type { StoredObjectApi } from "@langwatch/stored-object-contract";

import type { TraceMediaStore } from "../app/trace.members.ts";
import { TraceContentExtractionService } from "./trace-content-extraction.service.ts";

const SCENARIO_EVENT_MEDIA_FILENAME = "scenario-event-media";

class ScenarioEventMediaStore implements TraceMediaStore {
  static create(storedObjects: StoredObjectApi): ScenarioEventMediaStore {
    return new ScenarioEventMediaStore(storedObjects);
  }

  #storedObjects: StoredObjectApi;

  private constructor(storedObjects: StoredObjectApi) {
    this.#storedObjects = storedObjects;
  }

  async storeFromBytes(input: {
    projectId: string;
    purpose: string;
    ownerKind: string;
    ownerId: string;
    mediaType: string;
    bytes: Buffer;
  }): Promise<{ id: string; mediaType: string; isDuplicate: boolean }> {
    const stored = await this.#storedObjects.storeFromBytes({
      projectId: input.projectId,
      filename: SCENARIO_EVENT_MEDIA_FILENAME,
      mediaType: input.mediaType,
      audience: "scenarios:view",
      bytes: input.bytes,
      purpose: "scenario_event",
      ownerKind: "scenario_run",
      ownerId: input.ownerId,
    });

    return {
      id: stored.reference.id,
      mediaType: stored.reference.mediaType,
      isDuplicate: stored.isDuplicate,
    };
  }
}

/** Trace's callable scenario-event media operation over Stored Object's full peer API. */
export class TraceScenarioEventMediaService {
  static create(storedObjects: StoredObjectApi): TraceScenarioEventMediaService {
    return new TraceScenarioEventMediaService(ScenarioEventMediaStore.create(storedObjects));
  }

  #store: TraceMediaStore;

  private constructor(store: TraceMediaStore) {
    this.#store = store;
  }

  extractInlineMediaFromEvent(input: {
    event: unknown;
    projectId: string;
    ownerKind: "scenario_run";
    ownerId: string;
    purpose: "scenario_event";
  }): Promise<{ rewrittenEvent: unknown; refs: readonly { id: string }[] }> {
    return TraceContentExtractionService.extractInlineMediaFromEvent({
      event: input.event,
      projectId: input.projectId,
      ownerKind: "scenario_run",
      ownerId: input.ownerId,
      purpose: "scenario_event",
      service: this.#store,
    });
  }
}
