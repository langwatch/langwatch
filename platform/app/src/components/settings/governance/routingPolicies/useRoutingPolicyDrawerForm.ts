/**
 * Everything the routing-policy drawer needs to render, derived in one place:
 * the form, the row it is editing, the providers it can offer, and the
 * problems worth telling the operator about before they save.
 *
 * Returns state and callbacks, never JSX.
 */
import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";

import type { ScopeTriadEntry } from "~/components/settings/ScopeChipPicker";
import { api } from "~/utils/api";

import type { ProviderCredentialOption } from "./ProviderCredentialPicker";
import {
  emptyRoutingPolicyForm,
  type RoutingPolicyFormValues,
  routingPolicyToFormValues,
  validateRoutingPolicyForm,
} from "./routingPolicyForm";

export interface OrganizationShape {
  id?: string;
  name?: string;
  teams?: Array<{
    id: string;
    name: string;
    projects: Array<{ id: string; name: string }>;
  }>;
}

export function useRoutingPolicyDrawerForm({
  policyId,
  organizationId,
  organization,
  seedScopes,
  seedIsDefault,
}: {
  policyId: string | null;
  organizationId: string;
  organization: OrganizationShape | null | undefined;
  seedScopes: ScopeTriadEntry[];
  seedIsDefault: boolean;
}) {
  const policyQuery = api.routingPolicy.get.useQuery(
    { organizationId, id: policyId ?? "" },
    { enabled: !!organizationId && !!policyId, refetchOnWindowFocus: false },
  );

  // One row per configured provider. The project-scoped listing collapses
  // rows that share a provider key, which would render every second entry of
  // an existing policy as an unknown provider.
  const providersQuery =
    api.modelProvider.listAllForOrganizationForFrontend.useQuery(
      { organizationId },
      { enabled: !!organizationId, refetchOnWindowFocus: false },
    );

  const form = useForm<RoutingPolicyFormValues>({
    defaultValues: emptyRoutingPolicyForm(seedScopes, seedIsDefault),
  });
  const { reset, watch } = form;

  const policy = policyQuery.data;
  useEffect(() => {
    if (!policy) return;
    reset(routingPolicyToFormValues(policy));
  }, [policy, reset]);

  const providers = providersQuery.data?.providers;
  const providerOptions: ProviderCredentialOption[] = useMemo(
    () =>
      (providers ?? [])
        .filter((provider) => !!provider.id)
        .map((provider) => ({
          id: provider.id!,
          modelProviderName: provider.name ?? provider.provider,
          slot: "primary",
          disabledAt: provider.disabledAt
            ? new Date(provider.disabledAt).toISOString()
            : null,
          healthStatus: provider.healthStatus ?? "UNKNOWN",
        })),
    [providers],
  );

  const values = watch();
  const boundProviderTypes = useMemo(() => {
    const byId = new Map(
      (providers ?? []).map((provider) => [provider.id, provider.provider]),
    );
    return values.modelProviderIds
      .map((id) => byId.get(id))
      .filter((type): type is string => !!type);
  }, [values.modelProviderIds, providers]);

  const problems = useMemo(
    () =>
      validateRoutingPolicyForm({
        values,
        boundProviderTypes: new Set(boundProviderTypes),
      }),
    [values, boundProviderTypes],
  );

  const { availableTeams, availableProjects } = useScopeOptions(
    organization?.teams,
  );

  const scopesWithNames = useMemo(
    () => namedScopes({ scopes: values.scopes, organization }),
    [values.scopes, organization],
  );

  return {
    form,
    values,
    problems,
    boundProviderTypes,
    providerOptions,
    providersLoading: providersQuery.isLoading,
    policyLoading: policyQuery.isLoading,
    availableTeams,
    availableProjects,
    scopesWithNames,
  };
}

/** The teams and projects the scope picker offers. */
function useScopeOptions(teams: OrganizationShape["teams"]) {
  const availableTeams = useMemo(
    () => teams?.map((team) => ({ id: team.id, name: team.name })) ?? [],
    [teams],
  );
  const availableProjects = useMemo(
    () =>
      teams?.flatMap((team) =>
        team.projects.map((project) => ({
          id: project.id,
          name: `${project.name} · ${team.name}`,
          teamId: team.id,
        })),
      ) ?? [],
    [teams],
  );
  return { availableTeams, availableProjects };
}

function namedScopes({
  scopes,
  organization,
}: {
  scopes: ScopeTriadEntry[];
  organization: OrganizationShape | null | undefined;
}): ScopeTriadEntry[] {
  const teamNames = new Map<string, string>();
  const projectNames = new Map<string, string>();
  for (const team of organization?.teams ?? []) {
    teamNames.set(team.id, team.name);
    for (const project of team.projects) {
      projectNames.set(project.id, project.name);
    }
  }
  return scopes.map((scope) => ({
    ...scope,
    name:
      scope.scopeType === "ORGANIZATION"
        ? organization?.name
        : scope.scopeType === "TEAM"
          ? teamNames.get(scope.scopeId)
          : projectNames.get(scope.scopeId),
  }));
}
