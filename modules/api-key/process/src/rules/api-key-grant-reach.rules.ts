import type { ApiKeyBinding } from "@langwatch/api-key-contract";
import type { ProjectIdentity } from "@langwatch/project-contract";

/** The two fields a reach answer turns on, so the schema's own verified rows qualify too. */
type ScopedBinding = Pick<ApiKeyBinding, "scopeType" | "scopeId">;

/**
 * Whether the key's own grants reach the project a caller named. An organization binding
 * reaches every project in it, a team binding every project on that team, a project binding
 * only its own.
 */
export function bindingsReachProject(
  bindings: readonly ScopedBinding[],
  project: ProjectIdentity,
): boolean {
  return bindings.some((binding) => {
    if (binding.scopeType === "ORGANIZATION") {
      return binding.scopeId === project.organizationId;
    }

    if (binding.scopeType === "TEAM") {
      return binding.scopeId === project.teamId;
    }

    return binding.scopeId === project.id;
  });
}

/** The distinct projects a key's own grants name; a key bound to exactly one answers it alone. */
export function findGrantedProjectIds(bindings: readonly ScopedBinding[]): string[] {
  const projectIds = new Set(
    bindings.flatMap((binding) =>
      binding.scopeType === "PROJECT" && binding.scopeId ? [binding.scopeId] : [],
    ),
  );

  return [...projectIds];
}
