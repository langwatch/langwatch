/**
 * Role Bindings — every grant in the organization, grouped by who holds it.
 *
 * Moved from `platform/app/src/pages/settings/role-bindings.tsx`. It is an
 * AUDIT surface: one read, no writes, and the reason it is gated at
 * `organization:manage` is that the payload names every user, every group and
 * every scope in the organization.
 *
 * WHAT THE FILTER IS, AND IS NOT. Four buttons over a list already in memory,
 * held in component state. Two earlier families corrected a filter that
 * MIRRORED the URL into `useState`; there is nothing to correct here, because
 * this one has never been in the URL at all. Putting it there would be a new
 * behaviour rather than a preserved one, and a page move is not where that
 * belongs.
 *
 * The scope-picker surface next door is deliberately not used: that control
 * WRITES which scopes a rule applies to, and this page only reads which tier a
 * binding sits at.
 */

import {
  Badge,
  Box,
  Button,
  Card,
  Heading,
  HStack,
  Separator,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { roleBindingScopeTypeSchema } from "@langwatch/authz-contract";
import { Users } from "lucide-react";
import { useState } from "react";
import { authzApi } from "../../behavior/authz-api";
import { useAuthzHost } from "../../model/authz-host";
import {
  type BindingPrincipal,
  type BindingScopeFilter,
  bindingsInFilter,
  groupBindingsByPrincipal,
  type RoleBinding,
  roleBadgePalette,
  scopeLabel,
  scopePalette,
  scopePillText,
} from "../../model/role-binding-principals";
import { EnterpriseUpsell } from "../../ui/elements/enterprise-upsell";
import { PrincipalAvatar } from "../../ui/elements/principal-avatar";

const SCOPE_TIERS = roleBindingScopeTypeSchema.enum;

const FILTERS: ReadonlyArray<{ label: string; value: BindingScopeFilter }> = [
  { label: "All", value: "ALL" },
  { label: scopeLabel(SCOPE_TIERS.ORGANIZATION), value: SCOPE_TIERS.ORGANIZATION },
  { label: scopeLabel(SCOPE_TIERS.TEAM), value: SCOPE_TIERS.TEAM },
  { label: scopeLabel(SCOPE_TIERS.PROJECT), value: SCOPE_TIERS.PROJECT },
];

export default function RoleBindingsScreen() {
  const host = useAuthzHost();
  const { organizationId } = host.scope();
  const { isEnterprise, isLoading: isPlanLoading } = host.plan();
  const [scopeFilter, setScopeFilter] = useState<BindingScopeFilter>("ALL");

  const { data: bindings, isLoading } = authzApi.roleBinding.listForOrg.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: !!organizationId && isEnterprise },
  );

  if (isPlanLoading || !organizationId) return <Spinner />;

  if (!isEnterprise) return <EnterpriseUpsell />;

  const principals = groupBindingsByPrincipal(bindingsInFilter(bindings ?? [], scopeFilter));

  return (
    <VStack align="start" gap={6} width="full">
      <VStack align="start" gap={1} width="full">
        <Heading as="h2">Role Bindings</Heading>
        <Text color="fg.muted" fontSize="sm">
          All role bindings in this organization.
        </Text>
      </VStack>

      <Separator />

      <HStack width="full">
        <HStack gap={1}>
          {FILTERS.map((filter) => (
            <Button
              key={filter.value}
              size="sm"
              variant={scopeFilter === filter.value ? "subtle" : "ghost"}
              colorPalette={scopeFilter === filter.value ? "blue" : "gray"}
              onClick={() => setScopeFilter(filter.value)}
            >
              {filter.label}
            </Button>
          ))}
        </HStack>
        <Spacer />
        {bindings && (
          <Text fontSize="sm" color="fg.muted">
            {principals.length} {principals.length === 1 ? "principal" : "principals"}
          </Text>
        )}
      </HStack>

      <Card.Root width="full" overflow="hidden">
        <Card.Body paddingY={0} paddingX={0} overflowX="auto">
          {isLoading ? (
            <Box padding={8} display="flex" justifyContent="center">
              <Spinner />
            </Box>
          ) : principals.length === 0 ? (
            <Box padding={8} textAlign="center">
              <Text color="fg.muted">No role bindings found.</Text>
            </Box>
          ) : (
            <Table.Root variant="line" size="md" width="full">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader width="240px">Who</Table.ColumnHeader>
                  <Table.ColumnHeader textAlign="right">Access</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {principals.map((principal) => (
                  <Table.Row key={principal.key}>
                    <Table.Cell>
                      <PrincipalCell principal={principal} />
                    </Table.Cell>
                    <Table.Cell>
                      <BindingsCell bindings={principal.bindings} />
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          )}
        </Card.Body>
      </Card.Root>
    </VStack>
  );
}

/** Who the row is about: a member with a face, or a group with an icon. */
function PrincipalCell({ principal }: { principal: BindingPrincipal }) {
  if (principal.userId) {
    return (
      <HStack gap={2}>
        <PrincipalAvatar
          id={principal.userId}
          name={principal.userName ?? principal.userEmail ?? "?"}
          image={principal.userImage}
          size="xs"
        />
        <VStack gap={0} align="start">
          {principal.userName && (
            <Text fontWeight="medium" fontSize="sm">
              {principal.userName}
            </Text>
          )}
          <Text fontSize="xs" color="fg.muted">
            {principal.userEmail ?? ""}
          </Text>
        </VStack>
      </HStack>
    );
  }

  return (
    <HStack gap={2}>
      <Box
        width="6"
        height="6"
        borderRadius="full"
        bg="blue.subtle"
        display="flex"
        alignItems="center"
        justifyContent="center"
        flexShrink={0}
      >
        <Users size={12} />
      </Box>
      <VStack gap={0} align="start">
        <Text fontWeight="medium" fontSize="sm">
          {principal.groupName ?? "Unknown group"}
        </Text>
        {principal.groupScimSource && (
          <Badge size="xs" colorPalette="blue">
            {principal.groupScimSource.toUpperCase()}
          </Badge>
        )}
      </VStack>
    </HStack>
  );
}

/** What the row can do, and where: one line per binding. */
function BindingsCell({ bindings }: { bindings: readonly RoleBinding[] }) {
  return (
    <VStack gap={1} align="end">
      {bindings.map((binding) => (
        <HStack key={binding.id} gap={1}>
          <Badge colorPalette={roleBadgePalette(binding.role)} size="sm">
            {binding.customRoleName ?? binding.role}
          </Badge>
          <Text fontSize="xs" color="fg.muted">
            on
          </Text>
          <Badge colorPalette={scopePalette(binding.scopeType)} size="sm">
            {scopePillText(binding)}
          </Badge>
        </HStack>
      ))}
    </VStack>
  );
}
