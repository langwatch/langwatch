import { ForkAwarePermissionDecisionRepository } from "~/server/app-layer/permissions/permission-decision.repository";
import { PermissionsService } from "~/server/app-layer/permissions/permissions.service";

/**
 * Factory body for `vi.mock("~/server/app-layer/app", ...)` in tests that
 * drive a declared permission check (`.permission()` / `.permissionAny()` /
 * the REST credential middlewares) without initializing a real App.
 *
 * The returned App exposes the REAL `PermissionsService` over the REAL
 * `ForkAwarePermissionDecisionRepository`, so a test's existing
 * `vi.mock("~/server/api/rbac")` resolver stubs keep deciding every check —
 * only the App lookup is faked. The client handed to the repository is inert:
 * the fork-aware resolvers receive it as an argument and the stubs never
 * touch it.
 *
 * Usage:
 * ```ts
 * vi.mock("~/server/app-layer/app", async () => {
 *   const { appPermissionsMock } = await import(
 *     "~/test-utils/appPermissionsMock"
 *   );
 *   return appPermissionsMock();
 * });
 * ```
 */
/**
 * Just the service, for tests whose own `vi.mock("~/server/app-layer/app")`
 * fake carries other groups — merge this in as `permissions`.
 */
export function appPermissionsService(): PermissionsService {
  return new PermissionsService({
    decisions: new ForkAwarePermissionDecisionRepository({} as never),
    // Credential (API-key) checks are a different seam with a heavier module
    // graph; a test that needs them mocks the credential path itself.
    credentials: {
      findApiKeyDecision: () => {
        throw new Error(
          "credential checks are not stubbed by appPermissionsMock",
        );
      },
      findApiKeyProjectDecisions: () => {
        throw new Error(
          "credential checks are not stubbed by appPermissionsMock",
        );
      },
      findProjectScope: () => {
        throw new Error(
          "credential checks are not stubbed by appPermissionsMock",
        );
      },
    },
  });
}

export function appPermissionsMock() {
  const permissions = appPermissionsService();
  return {
    getApp: () => ({ permissions }),
    tryGetApp: () => null,
  };
}
