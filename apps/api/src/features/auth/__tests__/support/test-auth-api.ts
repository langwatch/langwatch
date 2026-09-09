import type { AuthApi } from "@langwatch/auth-contract";
import { AuthUnavailableError } from "@langwatch/auth-server";

/**
 * An auth application that refuses every operation by name.
 *
 * Composition tests mount the signed-out namespace to prove it is THERE, not to
 * exercise it; a stub that answered would let a suite pass against a door that
 * never reached the module. The production graph installs the real application,
 * so nothing but a test ever holds this.
 */
export function testAuthApi(): AuthApi {
  const refuse = (): never => {
    throw new AuthUnavailableError({
      capability: "auth application",
      processName: "langwatch-api-test",
    });
  };

  return new Proxy({}, { get: () => refuse, has: () => true }) as AuthApi;
}
