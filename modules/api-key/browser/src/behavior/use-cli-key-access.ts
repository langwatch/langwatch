/** What the minted CLI key may reach: its scopes and, within them, its permissions. */

import {
  cliPermissionCategories,
  defaultCliKeyPermissions,
  type AccessLevel,
} from "@langwatch/api-key-contract";
import type { ScopeTriadEntry } from "@langwatch/design-system/scope-chip-picker";
import { useEffect, useMemo, useState } from "react";

import { clampSelectionsToAvailability } from "../model/api-key-permissions.ts";
import { cliKeyPermissions, cliSelectionsFromPermissions } from "../model/cli-key-permissions.ts";
import { defaultCliKeyScopes } from "../model/cli-key-scope-defaults.ts";
import { useGrantablePermissions } from "./use-grantable-permissions.ts";

type Binding = { scopeType: string; scopeId: string; role: string };
type OfferedProject = { id: string; teamId: string };

function scopeDefaults({
  organizationId,
  bindings,
  sharedTeams,
  personalProject,
}: {
  organizationId: string;
  bindings: Binding[];
  sharedTeams: { id: string }[];
  personalProject: OfferedProject | null | undefined;
}) {
  return defaultCliKeyScopes({
    organizationId,
    bindings,
    sharedTeamIds: sharedTeams.map((team) => team.id),
    personalProject: personalProject
      ? { id: personalProject.id, teamId: personalProject.teamId }
      : null,
  });
}

/**
 * Scopes preselect to the widest access the reader holds, once per organization: a
 * refetch of the bindings never clobbers scopes the reader already edited.
 */
export function useCliKeyScopes({
  organizationId,
  requiresProject,
  bindings,
  sharedTeams,
  personalProject,
}: {
  organizationId: string | null;
  requiresProject: boolean;
  bindings: Binding[] | undefined;
  sharedTeams: { id: string }[];
  personalProject: OfferedProject | null | undefined;
}) {
  const [selectedScopes, setSelectedScopes] = useState<ScopeTriadEntry[]>([]);
  const [defaultsOrgId, setDefaultsOrgId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedScopes([]);
    setDefaultsOrgId(null);
  }, [organizationId]);

  useEffect(() => {
    if (requiresProject || !organizationId || !bindings) return;
    if (defaultsOrgId === organizationId) return;
    setSelectedScopes(scopeDefaults({ organizationId, bindings, sharedTeams, personalProject }));
    setDefaultsOrgId(organizationId);
  }, [requiresProject, organizationId, bindings, defaultsOrgId, sharedTeams, personalProject]);

  // Whether the picker has anything to offer THIS reader, read from the same defaults:
  // a team the reader holds no binding on is not a scope they can bind.
  const hasAnyScopeToOffer = useMemo(() => {
    if (!organizationId || !bindings) return false;
    return scopeDefaults({ organizationId, bindings, sharedTeams, personalProject }).length > 0;
  }, [organizationId, bindings, sharedTeams, personalProject]);

  return { selectedScopes, setSelectedScopes, hasAnyScopeToOffer };
}

/**
 * The key's permissions, never above the reader's own access in EVERY selected scope
 * (the mint refuses the whole approval over one too many): untouched, the everyday
 * default narrowed to that ceiling; customised, the selections, re-narrowed as it shrinks.
 */
export function useCliKeyPermissions({
  organizationId,
  selectedScopes,
  management,
}: {
  organizationId: string | null;
  selectedScopes: ScopeTriadEntry[];
  /** Whether the CLI asked for management access (`langwatch login --management`). */
  management: boolean;
}) {
  const [isCustomized, setIsCustomized] = useState(false);
  const [selections, setSelections] = useState<Record<string, AccessLevel | "none">>({});

  useEffect(() => {
    setIsCustomized(false);
    setSelections({});
  }, [organizationId]);

  // The mint's own ceiling, so access held through a group or an inherited role counts.
  const grantable = useGrantablePermissions({
    organizationId: organizationId ?? "",
    scopes: selectedScopes,
    isServiceKey: false,
    enabled: !!organizationId,
  });
  const userPermissions = grantable.permissions;

  const defaultPermissionsHeld = useMemo<string[]>(() => {
    const held = new Set(userPermissions);
    return defaultCliKeyPermissions({ management }).filter((permission) => held.has(permission));
  }, [userPermissions, management]);

  const effectiveSelections = useMemo(
    () =>
      clampSelectionsToAvailability({
        selections,
        userPermissions,
        categories: cliPermissionCategories(),
      }),
    [selections, userPermissions],
  );

  const permissions = useMemo<string[]>(
    () =>
      cliKeyPermissions({
        isCustomized,
        selections: effectiveSelections,
        defaultPermissionsHeld,
      }),
    [isCustomized, effectiveSelections, defaultPermissionsHeld],
  );

  const toggleCustomized = () => {
    setSelections(isCustomized ? {} : cliSelectionsFromPermissions(defaultPermissionsHeld));
    setIsCustomized(!isCustomized);
  };

  return {
    isCustomized,
    toggleCustomized,
    userPermissions,
    isLoadingCeiling: grantable.isLoading,
    isCeilingFailed: grantable.isError,
    effectiveSelections,
    setSelections,
    permissions,
  };
}
