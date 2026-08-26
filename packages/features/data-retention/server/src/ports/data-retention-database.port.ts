type DelegateCall<TResult> = {
  bivariant(input: object): Promise<TResult>;
}["bivariant"];

type RetentionPolicyDelegate = {
  findMany: DelegateCall<unknown[]>;
  findUnique: DelegateCall<unknown | null>;
  upsert: DelegateCall<unknown>;
  deleteMany: DelegateCall<{ count: number }>;
};

type PinnedTraceDelegate = {
  findUnique: DelegateCall<unknown | null>;
  findMany: DelegateCall<unknown[]>;
  upsert: DelegateCall<unknown>;
  deleteMany: DelegateCall<{ count: number }>;
};

/** Process-owned database capability used only by private Data Retention repositories. */
export abstract class DataRetentionDatabasePort {
  abstract readonly retentionPolicy: RetentionPolicyDelegate;
  abstract readonly pinnedTrace: PinnedTraceDelegate;
}
