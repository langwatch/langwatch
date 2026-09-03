/**
 * Everything the routing-policy drawer needs to render, derived in one place:
 * the form, the row it is editing, the providers it can offer, and the
 * problems worth telling the operator about before they save.
 *
 * Returns state and callbacks, never JSX.
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";

import type { ScopeTriadEntry } from "@langwatch/authz-web/surfaces/scope-picker";
import { api } from "../../../behavior/gateway-api";

import type { ProviderCredentialOption } from "../model/provider-credential-option";
import {
  emptyRoutingPolicyForm,
  type RoutingPolicyFormValues,
  routingPolicyFormSchema,
  routingPolicyToFormValues,
  validateRoutingPolicyForm,
} from "../model/routing-policy-form";

export interface OrganizationShape {
  id?: string;
  name?: string;
  // Readonly, because the host hands the organization graph over as a value it
  // still owns; nothing here writes to it.
  teams?: readonly {
    id: string;
    name: string;
    projects: readonly { id: string; name: string }[];
  }[];
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
  const providersQuery = api.modelProvider.listAllForOrganizationForFrontend.useQuery(
    { organizationId },
    { enabled: !!organizationId, refetchOnWindowFocus: false },
  );

  // The schema runs, rather than only typing the form: its required-field
  // messages and the name length limit are the ones the operator reads, and a
  // schema used for inference alone silently enforces nothing.
  const form = useForm<RoutingPolicyFormValues>({
    defaultValues: emptyRoutingPolicyForm(seedScopes, seedIsDefault),
    resolver: zodResolver(routingPolicyFormSchema),
    mode: "onChange",
  });
  const { reset, watch } = form;

  const policy = policyQuery.data;
  useEffect(() => {
    if (!policy) return;
    reset(routingPolicyToFormValues(policy));
  }, [policy, reset]);

  const values = watch();
  const { providerOptions, boundProviderTypes } = useProviderOptions({
    providers: providersQuery.data,
    selectedIds: values.modelProviderIds,
  });

  const problems = useMemo(
    () =>
      validateRoutingPolicyForm({
        values,
        boundProviderTypes: new Set(boundProviderTypes),
      }),
    [values, boundProviderTypes],
  );

  const { availableTeams, availableProjects } = useScopeOptions(organization?.teams);

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

/**
 * The providers the picker offers, and the provider types the currently
 * selected ones resolve to, which is what a name mapping is validated against.
 */
function useProviderOptions({
  providers,
  selectedIds,
}: {
  providers:
    | Array<{
        id?: string | null;
        name?: string | null;
        provider: string;
        disabledAt?: Date | string | null;
        healthStatus?: string | null;
      }>
    | undefined;
  selectedIds: string[];
}) {
  const providerOptions: ProviderCredentialOption[] = useMemo(
    () =>
      (providers ?? [])
        .filter((provider) => !!provider.id)
        .map((provider) => ({
          id: provider.id!,
          modelProviderName: provider.name ?? provider.provider,
          slot: "primary",
          disabledAt: provider.disabledAt ? new Date(provider.disabledAt).toISOString() : null,
          healthStatus: provider.healthStatus ?? "UNKNOWN",
        })),
    [providers],
  );

  // Which provider types the tier suggestions are drawn from. A new policy
  // starts with no provider picked, and an empty list means no filtering at
  // all, which would offer the whole catalog including vendors the
  // organization has no credential for. Falling back to the providers the
  // organization does have keeps every suggestion one it could serve.
  const boundProviderTypes = useMemo(() => {
    const all = (providers ?? []).map((provider) => provider.provider);
    if (selectedIds.length === 0) return [...new Set(all)];
    const byId = new Map((providers ?? []).map((provider) => [provider.id, provider.provider]));
    return [
      ...new Set(selectedIds.map((id) => byId.get(id)).filter((type): type is string => !!type)),
    ];
  }, [selectedIds, providers]);

  return { providerOptions, boundProviderTypes };
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
