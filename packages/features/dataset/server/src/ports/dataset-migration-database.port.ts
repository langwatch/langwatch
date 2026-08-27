type DelegateCall<TResult> = {
  bivariant(input: object): Promise<TResult>;
}["bivariant"];

type DatasetLayoutRow = {
  contentLayout: string;
  useS3: boolean;
};

type DatasetRecordRow = {
  id: string;
  entry: unknown;
};

export type DatasetMigrationFingerprintRow = {
  _count: { _all: number };
  _max: { updatedAt: Date | null };
};

type DatasetDelegate = {
  findFirst: DelegateCall<DatasetLayoutRow | null>;
  findMany: DelegateCall<Array<{ id: string }>>;
  update: DelegateCall<unknown>;
};

export type DatasetMigrationFingerprintDatabase = {
  aggregate: DelegateCall<DatasetMigrationFingerprintRow>;
};

export type DatasetMigrationRecordDatabase = DatasetMigrationFingerprintDatabase & {
  findMany: DelegateCall<DatasetRecordRow[]>;
};

type DatasetTransactionDelegate = {
  findFirst: DelegateCall<DatasetLayoutRow | null>;
  update: DelegateCall<unknown>;
};

type ProjectDelegate = {
  findMany: DelegateCall<Array<{ id: string }>>;
};

type ExecuteRawCall = {
  bivariant(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}["bivariant"];

type DatasetMigrationTransaction = {
  $executeRaw: ExecuteRawCall;
  dataset: DatasetTransactionDelegate;
  datasetRecord: DatasetMigrationFingerprintDatabase;
};

type TransactionCall = {
  bivariant<TResult>(
    operation: (database: DatasetMigrationTransaction) => Promise<TResult>,
    options: { timeout: number; maxWait: number },
  ): Promise<TResult>;
}["bivariant"];

/** Structural database capability accepted by Dataset process composition. */
export abstract class DatasetMigrationDatabasePort {
  abstract readonly project: ProjectDelegate;
  abstract readonly dataset: DatasetDelegate;
  abstract readonly datasetRecord: DatasetMigrationRecordDatabase;
  abstract readonly $transaction: TransactionCall;
}
