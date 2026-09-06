/**
 * Where a project's NLP Lambda ARN is resolved from, and where it is shared.
 * An ARN costs 2-N AWS control-plane calls against a REGIONAL quota, so one
 * tenant's burst can exhaust it fleet-wide unless a resolution is shared.
 */

/** One project's resolved function, as the shared cache holds it. */
export type NlpLambdaArnEntry = Readonly<{
  arn: string;
  /** The deployment image it was resolved under; a change invalidates it. */
  imageUri: string;
}>;

/**
 * A cluster-wide store with an expiry. Redis in production; a process with none
 * composes an in-memory stand-in, which is slower rather than wrong.
 */
export abstract class NlpLambdaArnCachePort {
  abstract tryGet(key: string): Promise<string | null>;

  abstract set(input: { key: string; value: string; ttlSeconds: number }): Promise<void>;

  abstract delete(key: string): Promise<void>;
}

/** The AWS flow that finds, creates or updates the project's function. */
export abstract class NlpLambdaArnResolverPort {
  abstract resolve(input: { projectId: string; imageUri: string }): Promise<string>;
}
