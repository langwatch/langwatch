/**
 * A stand-in for the server's `apiKey.grantablePermissions`, mirroring the authz resolver
 * for direct grants: what these bindings may put on a key bound to every one of these
 * scopes, so a screen test can seed bindings and see the rows they open.
 */

import { categorizablePermissions } from "@langwatch/api-key-contract";
import { bindingScopeCanGrantPermission, builtinRolePermissions } from "@langwatch/authz-contract";

import { teamRolePermissions } from "../../../../model/api-key-permissions.ts";

type Binding = { scopeType: string; scopeId: string; role: string };
type Scope = { scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string };

export function fakeGrantable({
  bindings,
  scopes,
  projectTeams = {},
}: {
  bindings: Binding[] | undefined;
  scopes: Scope[];
  /** Which team each project sits in, so a team binding reaches its projects. */
  projectTeams?: Record<string, string>;
}): string[] {
  let grantable: string[] | null = null;
  for (const scope of scopes) {
    const held = new Set(
      (bindings ?? [])
        .filter((binding) => covers(binding, scope, projectTeams))
        .flatMap((binding) => conferred(binding)),
    );
    const candidates: readonly string[] = grantable ?? categorizablePermissions();
    grantable = candidates.filter(
      (permission) =>
        held.has(permission) &&
        bindingScopeCanGrantPermission({ scopeType: scope.scopeType, permission }),
    );
  }
  return grantable ?? [];
}

function covers(binding: Binding, scope: Scope, projectTeams: Record<string, string>): boolean {
  if (binding.scopeType === "ORGANIZATION") return true;
  if (binding.scopeType === scope.scopeType) return binding.scopeId === scope.scopeId;
  return (
    binding.scopeType === "TEAM" &&
    scope.scopeType === "PROJECT" &&
    projectTeams[scope.scopeId] === binding.scopeId
  );
}

function conferred(binding: Binding): string[] {
  if (binding.scopeType !== "ORGANIZATION") return teamRolePermissions(binding.role);
  if (binding.role === "ADMIN") return categorizablePermissions();
  return [...builtinRolePermissions("org-member")];
}

/** `useGrantablePermissions` answered by `fakeGrantable` over whatever bindings are seeded. */
export function fakeGrantableHook({
  bindings,
  projectTeams,
  failed = () => false,
}: {
  bindings: () => Binding[] | undefined;
  projectTeams?: Record<string, string>;
  failed?: () => boolean;
}) {
  return ({ scopes, isServiceKey }: { scopes: Scope[]; isServiceKey: boolean }) => ({
    permissions: isServiceKey
      ? categorizablePermissions()
      : fakeGrantable({
          bindings: bindings(),
          scopes: scopes.filter((scope) => scope.scopeId !== ""),
          ...(projectTeams ? { projectTeams } : {}),
        }),
    isLoading: false,
    isError: failed(),
    refetch: () => undefined,
  });
}
