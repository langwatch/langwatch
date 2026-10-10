import { Banner } from "@langwatch/design-system/banner";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Text, VStack } from "@langwatch/design-system/primitives";
import type { ScopeTriadEntry } from "@langwatch/design-system/scope-chip-picker";
import { HandledErrorAlert } from "@langwatch/error-views";
import { docsUrl } from "@langwatch/handled-error/docs-url";
import { useState } from "react";

import { api } from "../../../behavior/gateway-api.ts";
import { useOrganizationTeamProject } from "../../../behavior/gateway-session.ts";
import { useRoutingPolicyMutations } from "../../../features/routing-policies/behavior/use-routing-policy-mutations.ts";
import {
  RoutingPoliciesTable,
  type RoutingPolicyRow,
  type RoutingPolicyScopeLevel,
} from "../../../features/routing-policies/ui/blocks/routing-policies-table.tsx";
import { useGatewayHost } from "../../../model/gateway-host.ts";
import { isPermissionRefusal } from "../../../model/permission-refusal.ts";
import { Link } from "../../../ui/elements/gateway-link.tsx";
import {
  PermissionRefusedNotice,
  PermissionRequiredNotice,
} from "../../../ui/elements/permission-required-notice.tsx";
import AiGatewayLayout from "../../../ui/sections/gateway-layout.tsx";
import { ListSkeleton } from "../../elements/list-skeleton.tsx";

/**
 * Routing policy editor uses drawer registry (drawer.open=routingPolicy), not its own query key.
 * Spec: specs/ai-gateway/governance/admin-routing-policies.feature
 */
const ROUTING_POLICY_DRAWER = "routingPolicy" as const;

/**
 * Exported unwrapped so tests can render the page itself rather than the
 * flag and permission policy the route table now states around it.
 */
export function RoutingPoliciesPage() {
  const { organization } = useOrganizationTeamProject();
  const host = useGatewayHost();
  const organizationId = organization?.id ?? "";
  const canManage = host.hasPermission("routingPolicies:manage");

  const policiesQuery = api.routingPolicy.list.useQuery(
    { organizationId },
    { enabled: !!organizationId, refetchOnWindowFocus: false },
  );
  const cannotRead = isPermissionRefusal(policiesQuery.error);

  const [policyToDelete, setPolicyToDelete] = useState<RoutingPolicyRow | null>(null);

  const { setDefault, remove } = useRoutingPolicyMutations({ organizationId });

  const resolveScopeNames = useScopeNameResolver(organization);

  const policies = (policiesQuery.data ?? []) as RoutingPolicyRow[];
  const hasAnyDefault = policies.some((policy) => policy.isDefault);

  const openNew = (level: RoutingPolicyScopeLevel, isDefault = false) =>
    host.openDrawer({
      drawer: ROUTING_POLICY_DRAWER,
      params: {
        seedScopeType: level.toUpperCase(),
        seedScopeId: level === "organization" ? organizationId : "",
        seedIsDefault: isDefault ? "true" : "false",
      },
    });

  return (
    <AiGatewayLayout pageTitle="Routing Policies · AI Gateway · LangWatch">
      <PageLayout.Header>
        <PageLayout.Heading>Routing policies</PageLayout.Heading>
      </PageLayout.Header>

      <PageLayout.Container>
        <VStack align="stretch" gap={6} width="full">
          <PageDescription />

          {policiesQuery.isLoading && <ListSkeleton />}

          {policiesQuery.error ? <PolicyListFailure error={policiesQuery.error} /> : null}

          {/* "Publish a default policy" is an instruction, so it is only shown
            to whoever can carry it out. */}
          {canManage && !cannotRead && !policiesQuery.isLoading && !hasAnyDefault && (
            <NoDefaultNotice hasPolicies={policies.length > 0} />
          )}

          {!cannotRead && !policiesQuery.isLoading && (
            <RoutingPoliciesTable
              policies={policies}
              resolveScopeNames={resolveScopeNames}
              onNew={(level) => openNew(level)}
              onEdit={(policy) =>
                host.openDrawer({
                  drawer: ROUTING_POLICY_DRAWER,
                  params: { policyId: policy.id },
                })
              }
              onSetDefault={(policy) => setDefault.mutate({ organizationId, id: policy.id })}
              onDelete={setPolicyToDelete}
              canManage={canManage}
            />
          )}

          {!canManage && !cannotRead && (
            <PermissionRequiredNotice
              permission="routingPolicies:manage"
              detail="You can read the policies and the tiers they publish. Creating, editing, and deleting need this grant."
            />
          )}
        </VStack>
      </PageLayout.Container>

      <DeletePolicyDialog
        policy={policyToDelete}
        isDeleting={remove.isPending}
        onCancel={() => setPolicyToDelete(null)}
        onConfirm={() => {
          if (!policyToDelete) return;
          remove.mutate(
            { organizationId, id: policyToDelete.id },
            { onSuccess: () => setPolicyToDelete(null) },
          );
        }}
      />

      {/* The editor is not rendered here. `CurrentDrawer` mounts it in the
          host it needs, over whatever page the reader is on — which is the
          same mount a virtual key's "routes through" link lands on. */}
    </AiGatewayLayout>
  );
}

function DeletePolicyDialog({
  policy,
  isDeleting,
  onCancel,
  onConfirm,
}: {
  policy: RoutingPolicyRow | null;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={!!policy}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={`Delete "${policy?.name ?? ""}"?`}
      message={
        policy?.isDefault
          ? "Keys that use this policy stop working until you point them at another one, and new keys route through whichever providers they can reach until you publish another default here."
          : "Keys that use this policy stop working until you point them at another one."
      }
      confirmLabel="Delete policy"
      tone="danger"
      loading={isDeleting}
      onConfirm={onConfirm}
    />
  );
}

function PageDescription() {
  return (
    <Text color="fg.muted">
      Decide which providers and models your keys reach, and what the model tiers mean here. A
      project policy wins over a team policy, which wins over the organization policy.
    </Text>
  );
}

/**
 * A scope carrying the display name it resolved to. ScopeTriadEntry is the id
 * pair alone; everything downstream of the resolver renders the name, so it
 * belongs in the type rather than arriving as an untyped extra property.
 */
type NamedScope = ScopeTriadEntry & { name: string | undefined };

/** Turns scope ids into the names an operator recognizes. */
function useScopeNameResolver(
  organization:
    | {
        name?: string;
        teams?: readonly {
          id: string;
          name: string;
          projects: readonly { id: string; name: string }[];
        }[];
      }
    | null
    | undefined,
) {
  const names = (() => {
    const teams = new Map<string, string>();
    const projects = new Map<string, string>();
    for (const team of organization?.teams ?? []) {
      teams.set(team.id, team.name);
      for (const project of team.projects) {
        projects.set(project.id, project.name);
      }
    }
    return { teams, projects };
  })();

  return (scopes: ScopeTriadEntry[]): NamedScope[] =>
    scopes.map((scope) => {
      if (scope.scopeType === "ORGANIZATION") return { ...scope, name: organization?.name };
      const lookup = scope.scopeType === "TEAM" ? names.teams : names.projects;
      return { ...scope, name: lookup.get(scope.scopeId) };
    });
}

/**
 * Without a default policy a new key routes through whatever it can reach, so
 * this says what is missing where the operator can fix it.
 */
function NoDefaultNotice({ hasPolicies }: { hasPolicies: boolean }) {
  return (
    <Banner
      status="warning"
      title={hasPolicies ? "Pick a default policy" : "Publish a default policy"}
    >
      A default organization policy sets provider order and model tiers for new keys. Teams and
      projects can override it.{" "}
      <Link href={docsUrl("/ai-gateway/governance/routing-policies")} isExternal>
        Read the guide
      </Link>
    </Banner>
  );
}

/**
 * RBAC: routingPolicies:view opens page, routingPolicies:manage shows authoring controls.
 */
/** A refusal is not a failed load: it reads as no access. Any other failure keeps its error. */
function PolicyListFailure({ error }: { error: unknown }) {
  if (isPermissionRefusal(error)) {
    return (
      <PermissionRefusedNotice
        error={error}
        detail="Routing policies are read at the organization level."
      />
    );
  }
  return <HandledErrorAlert error={error} fallbackTitle="Couldn't load routing policies" />;
}

export default RoutingPoliciesPage;
