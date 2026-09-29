/** What the minted CLI key may reach: its scopes and, within them, its permissions. */

import {
  computePermissionsFromSelections,
  defaultCliKeyPermissions,
  selectionsFromPermissions,
  type AccessLevel,
} from "@langwatch/api-key-contract";
import type { ScopeTriadEntry } from "@langwatch/authz-browser-kit";
import { useEffect, useMemo, useState } from "react";

import {
  clampSelectionsToAvailability,
  getUserPermissionsAcrossScopes,
} from "../model/api-key-permissions.ts";
import { defaultCliKeyScopes } from "../model/cli-key-scope-defaults.ts";

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
  bindings,
  offeredProjects,
  management,
}: {
  organizationId: string | null;
  selectedScopes: ScopeTriadEntry[];
  bindings: Binding[] | undefined;
  offeredProjects: OfferedProject[];
  /** Whether the CLI asked for management access (`langwatch login --management`). */
  management: boolean;
}) {
  const [isCustomized, setIsCustomized] = useState(false);
  const [selections, setSelections] = useState<Record<string, AccessLevel | "none">>({});

  useEffect(() => {
    setIsCustomized(false);
    setSelections({});
  }, [organizationId]);

  const userPermissions = useMemo(() => {
    if (selectedScopes.length === 0 || !organizationId) return [];
    return getUserPermissionsAcrossScopes({
      myBindings: bindings,
      scopes: selectedScopes,
      organizationId,
      orgProjects: offeredProjects.map((p) => ({ id: p.id, teamId: p.teamId })),
      isServiceKey: false,
    });
  }, [selectedScopes, organizationId, bindings, offeredProjects]);

  const defaultPermissionsHeld = useMemo<string[]>(() => {
    const held = new Set(userPermissions);
    return defaultCliKeyPermissions({ management }).filter((permission) => held.has(permission));
  }, [userPermissions, management]);

  const effectiveSelections = useMemo(
    () => clampSelectionsToAvailability({ selections, userPermissions }),
    [selections, userPermissions],
  );

  const permissions = useMemo<string[]>(
    () =>
      isCustomized ? computePermissionsFromSelections(effectiveSelections) : defaultPermissionsHeld,
    [isCustomized, effectiveSelections, defaultPermissionsHeld],
  );

  const toggleCustomized = () => {
    setSelections(isCustomized ? {} : selectionsFromPermissions(defaultPermissionsHeld));
    setIsCustomized(!isCustomized);
  };

  return {
    isCustomized,
    toggleCustomized,
    userPermissions,
    effectiveSelections,
    setSelections,
    permissions,
  };
}
