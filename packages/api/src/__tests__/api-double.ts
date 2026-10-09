import type { Authorize } from "../access/access.ts";
import { PermissionDeniedError } from "@langwatch/authorization";

/** Missing methods throw when called, so adding a dependency cannot silently pass a test. */
export function createApiDouble<Api extends object>(
  overrides: Partial<Api> = {},
  name = "API double",
): Api {
  const target: Api = Object.create(null);
  Object.assign(target, overrides);
  return new Proxy(target, {
    get(held, property, receiver) {
      if (Reflect.has(held, property)) {
        return Reflect.get(held, property, receiver);
      }
      if (property === "then" || typeof property === "symbol") {
        return void 0;
      }
      return () => {
        throw new Error(`${name}.${property} is not configured for this test`);
      };
    },
  });
}

/**
 * The `Authorize` members a test does not ask about, as an ordinary project answers them; a
 * proof is refused. Spread first, so the members a test declares win.
 */
export const authorizeDefaults = {
  organizationOf: async () => null,
  getPlatformDecision: async () => ({ permitted: false }),
  projectKindOf: async () => "application",
  authorization: async ({ permission, projectId }) => {
    throw new PermissionDeniedError({
      permission,
      scope: { type: "project", id: projectId },
      denialReason: "no-grant",
    });
  },
  assertSecondFactor: async () => {},
} satisfies Omit<Authorize, "getDecision" | "getProjectAnyDecision" | "checkScopeLineage">;

/** An authorization port that permits every decision on an ordinary project. */
export const authorizationPort = {
  forRequest: (): Authorize => ({
    ...authorizeDefaults,
    getDecision: async () => ({ permitted: true, organizationRole: null }),
    getProjectAnyDecision: async () => ({ permitted: true, organizationRole: null }),
    checkScopeLineage: async () => ({ kind: "consistent" }),
  }),
};
