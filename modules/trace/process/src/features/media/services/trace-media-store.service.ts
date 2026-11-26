import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import {
  purposePolicyOf,
  type StoredObjectApi,
  type StoredObjectDeliveryAudience,
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
    /** When the owner's retention started, in epoch ms; absent means now. */
    retainFromMs?: number;
  }): Promise<{ id: string; isDuplicate: boolean }>;
}

/** How long the owner keeps its data, asked only for purposes that follow a retention category. */
export type TraceMediaRetention = Pick<DataRetentionApi, "getRetentionDays">;

/** Trace media held by Stored Object, one instance per purpose. */
export class TraceMediaStoreService implements TraceMediaStore {
  static create({
    storedObjects,
    purpose,
    retention,
  }: {
    storedObjects: StoredObjectApi;
    purpose: TraceMediaStorePurpose;
    retention?: TraceMediaRetention;
  }): TraceMediaStoreService {
    return new TraceMediaStoreService(storedObjects, purpose, retention);
  }

  private constructor(
    private readonly storedObjects: StoredObjectApi,
    private readonly target: TraceMediaStorePurpose,
    private readonly retention: TraceMediaRetention | undefined,
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
    /** When the owner's retention started, in epoch ms; absent means now. */
    retainFromMs?: number;
  }): Promise<{ id: string; isDuplicate: boolean }> {
    const retentionDays = await this.retentionDaysOf(input.projectId);
    const stored = await this.storedObjects.storeFromBytes({
      projectId: input.projectId,
      filename: this.target.filename,
      mediaType: input.mediaType,
      audience: this.target.audience,
      bytes: input.bytes,
      purpose: this.target.purpose,
      ownerKind: this.target.ownerKind,
      ownerId: input.ownerId,
      ...(retentionDays === undefined ? {} : { retentionDays }),
      ...(input.retainFromMs === undefined ? {} : { retainFromMs: input.retainFromMs }),
    });

    return { id: stored.reference.id, isDuplicate: stored.isDuplicate };
  }

  /** The owner's retention, which Stored Object links the media for (its ADR-002 §3). */
  private async retentionDaysOf(projectId: string): Promise<number | undefined> {
    const category = purposePolicyOf(this.target.purpose).retentionCategory;
    if (category === undefined) return undefined;
    if (!this.retention) throw new Error(`${this.target.purpose} media needs data-retention`);

    return this.retention.getRetentionDays({ projectId, category });
  }
}
