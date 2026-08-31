type DelegateCall<TResult> = {
  bivariant(input: object): Promise<TResult>;
}["bivariant"];

type ShareLinkDelegate = {
  findUnique: DelegateCall<unknown | null>;
  findFirst: DelegateCall<unknown | null>;
  findMany: DelegateCall<unknown[]>;
  count: DelegateCall<number>;
  create: DelegateCall<unknown>;
  update: DelegateCall<unknown>;
  deleteMany: DelegateCall<{ count: number }>;
};

type ProjectDelegate = {
  findUnique: DelegateCall<unknown | null>;
};

type GrantDelegate = {
  findMany: DelegateCall<unknown[]>;
};

type GrantUsageDelegate = {
  update: DelegateCall<unknown>;
  create: DelegateCall<unknown>;
};

export type ShareTransactionDatabase = {
  shareLink: Pick<ShareLinkDelegate, "update">;
  grantUsage: GrantUsageDelegate;
};

type TransactionCall = {
  bivariant<TResult>(
    operation: (database: ShareTransactionDatabase) => Promise<TResult>,
  ): Promise<TResult>;
}["bivariant"];

/** Structural process-owned database capability accepted by Share composition. */
export type ShareDatabase = {
  shareLink: ShareLinkDelegate;
  project: ProjectDelegate;
  grant: GrantDelegate;
  grantUsage: GrantUsageDelegate;
  $transaction: TransactionCall;
};
