/** Boot errors name the declaration and dependency that prevented readiness. */
/** Nothing in the graph provides a token some feature declared it needs. */
export class MissingProviderError extends Error {
  constructor(
    readonly feature: string,
    readonly dependencyKey: string,
    readonly token: string,
  ) {
    super(
      `Feature "${feature}" declares dependency "${dependencyKey}" on ${token}, and no installed feature provides it.`,
    );
    this.name = "MissingProviderError";
  }
}

/** Two features claim the same token, so no caller could say which it got. */
export class DuplicateProviderError extends Error {
  constructor(
    readonly token: string,
    readonly features: readonly string[],
  ) {
    super(`${token} is provided more than once, by: ${features.join(", ")}.`);
    this.name = "DuplicateProviderError";
  }
}

/** The same feature is declared twice on one application. */
export class DuplicateFeatureError extends Error {
  constructor(readonly feature: string) {
    super(`Feature "${feature}" is declared more than once on this application.`);
    this.name = "DuplicateFeatureError";
  }
}

/** The features depend on each other, so no construction order exists. */
export class DependencyCycleError extends Error {
  constructor(readonly cycle: readonly string[]) {
    super(`Feature dependencies form a cycle: ${cycle.join(" -> ")}.`);
    this.name = "DependencyCycleError";
  }
}

/** A feature contributes work the booting role does not host. */
export class RoleContributionError extends Error {
  constructor(
    readonly feature: string,
    readonly role: string,
    readonly contribution: string,
  ) {
    super(
      `Feature "${feature}" contributes ${contribution}, which the "${role}" role never hosts.`,
    );
    this.name = "RoleContributionError";
  }
}

/** The config handed to boot does not match what a feature declared. */
export class FeatureConfigError extends Error {
  constructor(
    readonly feature: string,
    readonly reason: string,
  ) {
    super(`Feature "${feature}" rejected its configuration: ${reason}`);
    this.name = "FeatureConfigError";
  }
}
