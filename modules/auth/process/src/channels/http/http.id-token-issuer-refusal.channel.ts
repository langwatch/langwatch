import { AsyncLocalStorage } from "node:async_hooks";

import { refusedIssuersIn } from "../../rules/id-token-issuer-mismatch.rules.ts";

/**
 * What Better Auth's logger saw of an ID token refused for its issuer, kept
 * per request so the callback's redirect can name the mismatch
 * (specs/identity/sso-issuer-mismatch.feature).
 */
export class IdTokenIssuerRefusalChannel {
  static create(): IdTokenIssuerRefusalChannel {
    return new IdTokenIssuerRefusalChannel();
  }

  private readonly scope = new AsyncLocalStorage<{ received: string[] }>();

  private constructor() {}

  /** Opens the per-request slot the logger writes into. */
  runWithScope<T>(run: () => Promise<T>): Promise<T> {
    return this.scope.run({ received: [] }, run);
  }

  /** Reads one logged line, keeping an `iss` refusal's issuer. */
  note(values: readonly unknown[]): void {
    const slot = this.scope.getStore();
    if (slot) slot.received.push(...refusedIssuersIn(values));
  }

  /** The issuers this request's ID tokens were refused for, first seen first. */
  findRefusedIssuers(): string[] {
    return [...(this.scope.getStore()?.received ?? [])];
  }
}
