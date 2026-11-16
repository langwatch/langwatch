import type {
  StoredObjectApi,
  StoredObjectDeliveryAudience,
} from "@langwatch/stored-object-contract";

/** Where one kind of extracted media is held, and who may read it back. */
export type TraceMediaStorePurpose = Readonly<{
  purpose: string;
  ownerKind: string;
  audience: StoredObjectDeliveryAudience;
  filename: string;
}>;

/** Span content media, owned by its trace and read back behind `traces:view`. */
export const TRACE_CONTENT_MEDIA: TraceMediaStorePurpose = {
  purpose: "trace_content",
  ownerKind: "trace",
  audience: "traces:view",
  filename: "trace-media",
};

/** Scenario event media, owned by its run and read back behind `scenarios:view`. */
export const SCENARIO_EVENT_MEDIA: TraceMediaStorePurpose = {
  purpose: "scenario_event",
  ownerKind: "scenario_run",
  audience: "scenarios:view",
  filename: "scenario-event-media",
};

/** Stores extracted bytes for one purpose; the owner is the only per-call fact. */
export interface TraceMediaStore {
  readonly purpose: string;
  readonly ownerKind: string;
  storeFromBytes(input: {
    projectId: string;
    ownerId: string;
    mediaType: string;
    bytes: Buffer;
  }): Promise<{ id: string; isDuplicate: boolean }>;
}

/** Trace media held by Stored Object, one instance per purpose. */
export class TraceMediaStoreService implements TraceMediaStore {
  static create({
    storedObjects,
    purpose,
  }: {
    storedObjects: StoredObjectApi;
    purpose: TraceMediaStorePurpose;
  }): TraceMediaStoreService {
    return new TraceMediaStoreService(storedObjects, purpose);
  }

  private constructor(
    private readonly storedObjects: StoredObjectApi,
    private readonly target: TraceMediaStorePurpose,
  ) {}

  get purpose(): string {
    return this.target.purpose;
  }

  get ownerKind(): string {
    return this.target.ownerKind;
  }

  async storeFromBytes(input: {
    projectId: string;
    ownerId: string;
    mediaType: string;
    bytes: Buffer;
  }): Promise<{ id: string; isDuplicate: boolean }> {
    const stored = await this.storedObjects.storeFromBytes({
      projectId: input.projectId,
      filename: this.target.filename,
      mediaType: input.mediaType,
      audience: this.target.audience,
      bytes: input.bytes,
      purpose: this.target.purpose,
      ownerKind: this.target.ownerKind,
      ownerId: input.ownerId,
    });

    return { id: stored.reference.id, isDuplicate: stored.isDuplicate };
  }
}
