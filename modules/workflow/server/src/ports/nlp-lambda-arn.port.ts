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

/** The AWS flow that finds, creates or updates the project's function. */
export abstract class NlpLambdaArnResolverPort {
  abstract resolve(input: { projectId: string; imageUri: string }): Promise<string>;
}

/**
 * Which function one project's engine answers on, as the caller needs it. The
 * resolution behind it is cached and single-flighted; a caller only asks.
 */
export abstract class NlpLambdaFunctionPort {
  abstract arnFor(input: { projectId: string }): Promise<string>;
}
