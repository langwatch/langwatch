/**
 * The Prisma row shapes the feature-flag adapters read, at the seam that owns
 * them: `Date` is what the client hands back, and the adapter converts.
 */

type DelegateCall<TResult> = {
  bivariant(input: object): Promise<TResult>;
}["bivariant"];

export type FeatureFlagRecord = {
  key: string;
  enabled: boolean;
  rules: unknown;
  lastEditedBy: string | null;
  updatedAt: Date;
};

export type FeatureFlagDelegate = {
  findUnique: DelegateCall<Pick<FeatureFlagRecord, "enabled" | "rules"> | null>;
  findMany: DelegateCall<FeatureFlagRecord[]>;
  upsert: DelegateCall<unknown>;
  deleteMany: DelegateCall<unknown>;
};

export type OrganizationDelegate = {
  findUnique: DelegateCall<{ createdAt: Date } | null>;
};
