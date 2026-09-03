import { createLogger } from "@langwatch/observability";
import {
  AuthzCutoverFailureReporter,
  type AuthzCutoverReadFailure,
} from "./postgres.authz-cutover.adapter";

export type AuthzCutoverCounter = { inc(): void };

export type ObservabilityAuthzCutoverAdapterOptions = {
  counter: AuthzCutoverCounter;
};

/** Structured warning plus counter, injected into the cutover adapter. */
export class ObservabilityAuthzCutoverAdapter extends AuthzCutoverFailureReporter {
  private readonly logger = createLogger("langwatch:authz:engine-gate");

  static create(
    options: ObservabilityAuthzCutoverAdapterOptions,
  ): ObservabilityAuthzCutoverAdapter {
    return new ObservabilityAuthzCutoverAdapter(options);
  }

  private constructor(private readonly options: ObservabilityAuthzCutoverAdapterOptions) {
    super();
  }

  report({ organizationId, error, ttlMs }: AuthzCutoverReadFailure): void {
    this.logger.warn(
      { organizationId, error, ttlMs },
      "could not read the authz migration state; this organization stays on the legacy path until the cache expires",
    );
    this.options.counter.inc();
  }
}
