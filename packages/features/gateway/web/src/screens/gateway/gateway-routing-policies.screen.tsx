import { Box, Button, Heading, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { Lightbulb, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import AiGatewayLayout from "../../ui/sections/gateway-layout";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { PermissionRequiredNotice } from "../../ui/elements/permission-required-notice";
import {
  RoutingPoliciesTable,
  type RoutingPolicyRow,
  type RoutingPolicyScopeLevel,
} from "../../features/routing-policies/ui/blocks/routing-policies-table";
import { useRoutingPolicyMutations } from "../../features/routing-policies/behavior/use-routing-policy-mutations";
import type { ScopeTriadEntry } from "@langwatch/authz-web/surfaces/scope-picker";
import { Link } from "../../ui/elements/gateway-link";
import { HandledErrorAlert } from "../../ui/elements/handled-error-alert";
import { useGatewayHost } from "../../model/gateway-host";
import { useOrganizationTeamProject } from "../../behavior/gateway-session";
import { api } from "../../behavior/gateway-api";
import { docsUrl } from "../../model/docs-url";

/**
 * The routing policy editor opens at the name the registry answers to.
 *
 * IT USED TO KEEP A KEY OF ITS OWN, `?policy=<id>` to edit and `?policy=new`
 * plus the seed to create, and render the editor inline. The reason was real —
 * the drawer registry is application composition a feature-web package may not
 * reach — and the conclusion did not follow: the registry is addressed by a
 * QUERY STRING, which the host already writes. So the screen names the drawer
 * and the host spells `?drawer.open=routingPolicy`, which is what the spec
 * asked for all along ("the address carries the policy, so the same link
 * reopens it", specs/ai-gateway/governance/admin-routing-policies.feature) and
 * what a virtual key's detail page already links to for the policy that key
 * routes through. One editor, one address, whichever page the reader came from.
 *
 * A create is the same drawer with no `policyId` rather than the sentinel the
 * screen's own key needed; the seed rides along as the drawer's own parameters.
 */
const ROUTING_POLICY_DRAWER = "routingPolicy" as const;

/**
 * Exported unwrapped so tests can render the page itself rather than the
 * flag and permission policy the route table now states around it.
 */
export function RoutingPoliciesPage() {
  const { organization, hasAnyPermission } = useOrganizationTeamProject();
  const organizationId = organization?.id ?? "";
  const host = useGatewayHost();
  const canManage = hasAnyPermission("routingPolicies:manage");

  const policiesQuery = api.routingPolicy.list.useQuery(
    { organizationId },
    { enabled: !!organizationId, refetchOnWindowFocus: false },
  );

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
      <VStack align="stretch" gap={6} width="full" maxW="container.xl">
        <PageHeading />

        {policiesQuery.isLoading && <Spinner size="sm" />}

        <HandledErrorAlert
          error={policiesQuery.error}
          fallbackTitle="Couldn't load routing policies"
        />

        {/* "Publish a default policy" is an instruction, so it is only shown
            to whoever can carry it out. */}
        {canManage && !policiesQuery.isLoading && !hasAnyDefault && (
          <NoDefaultNotice
            hasPolicies={policies.length > 0}
            onAddOrganizationPolicy={() => openNew("organization", true)}
          />
        )}

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

        {!canManage && (
          <PermissionRequiredNotice
            permission="routingPolicies:manage"
            detail="You can read the policies and the tiers they publish. Creating, editing, and deleting need this grant."
          />
        )}
      </VStack>

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

function PageHeading() {
  return (
    <VStack align="start" gap={0}>
      <Heading as="h2" size="lg">
        Routing policies
      </Heading>
      <Text color="fg.muted" fontSize="sm">
        Decide which providers and models your keys reach, and what the model tiers mean
        here. A project policy wins over a team policy, which wins over the organization
        policy.
      </Text>
    </VStack>
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
  const names = useMemo(() => {
    const teams = new Map<string, string>();
    const projects = new Map<string, string>();
    for (const team of organization?.teams ?? []) {
      teams.set(team.id, team.name);
      for (const project of team.projects) {
        projects.set(project.id, project.name);
      }
    }
    return { teams, projects };
  }, [organization?.teams]);

  return (scopes: ScopeTriadEntry[]): NamedScope[] =>
    scopes.map((scope) => ({
      ...scope,
      name:
        scope.scopeType === "ORGANIZATION"
          ? organization?.name
          : scope.scopeType === "TEAM"
            ? names.teams.get(scope.scopeId)
            : names.projects.get(scope.scopeId),
    }));
}

/**
 * Without a default policy a new key routes through whatever it can reach, so
 * this says what is missing where the operator can fix it.
 */
function NoDefaultNotice({
  hasPolicies,
  onAddOrganizationPolicy,
}: {
  hasPolicies: boolean;
  onAddOrganizationPolicy: () => void;
}) {
  return (
    <Box
      borderWidth="1px"
      borderColor="orange.300"
      borderRadius="md"
      backgroundColor="orange.50"
      padding={4}
    >
      <HStack alignItems="start" gap={3}>
        <Box color="orange.600" paddingTop="2px">
          <Lightbulb size={18} />
        </Box>
        <VStack align="start" gap={1}>
          <Text fontSize="sm" fontWeight="semibold">
            {hasPolicies ? "Pick a default policy" : "Publish a default policy"}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            Without one, a new key routes through whichever providers it can reach, in no
            order you chose, and the model tiers mean nothing. A default policy at the
            organization level pins both, and a team or project can still override it.
          </Text>
          <HStack gap={3} paddingTop={1}>
            <Button size="xs" colorPalette="orange" onClick={onAddOrganizationPolicy}>
              <Plus size={12} /> Add an organization policy
            </Button>
            <Link
              href={docsUrl("/ai-gateway/governance/routing-policies")}
              isExternal
              color="orange.700"
              fontSize="xs"
              fontWeight="medium"
            >
              Read the guide
            </Link>
          </HStack>
        </VStack>
      </HStack>
    </Box>
  );
}

/**
 * Routing policies are read with `routingPolicies:view` and written with
 * `routingPolicies:manage`, which is what the router asks for and what every
 * sibling Gateway page gates on. The page opens on the read grant; the
 * authoring controls appear only for the write one — the read grant and the
 * section flag are now stated once, in the route table this screen is bound
 * from, and the write grant is still asked here because it hides controls
 * rather than the page.
 */
export default RoutingPoliciesPage;
