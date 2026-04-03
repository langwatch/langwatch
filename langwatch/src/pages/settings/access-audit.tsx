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
import { Users } from "lucide-react";
import { useState } from "react";
import { RandomColorAvatar } from "~/components/RandomColorAvatar";
import SettingsLayout from "../../components/SettingsLayout";
import { ContactSalesBlock } from "../../components/subscription/ContactSalesBlock";
import { withPermissionGuard } from "../../components/WithPermissionGuard";
import { useActivePlan } from "../../hooks/useActivePlan";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import type { RouterOutputs } from "../../utils/api";
import { RoleBindingScopeType } from "@prisma/client";

type Binding = RouterOutputs["roleBinding"]["listForOrg"][number];

type ScopeFilter = "ALL" | RoleBindingScopeType;

// ── Helpers ───────────────────────────────────────────────────────────────────

function roleBadgeColor(role: string) {
  if (role === "ADMIN") return "red";
  if (role === "MEMBER") return "blue";
  if (role === "VIEWER") return "gray";
  return "purple";
}

function scopePillColor(type: RoleBindingScopeType) {
  if (type === RoleBindingScopeType.ORGANIZATION) return "orange";
  if (type === RoleBindingScopeType.TEAM) return "teal";
  return "purple";
}

function scopeLabel(type: RoleBindingScopeType) {
  if (type === RoleBindingScopeType.ORGANIZATION) return "Org";
  if (type === RoleBindingScopeType.TEAM) return "Team";
  return "Project";
}

// ── Principal cell ────────────────────────────────────────────────────────────

function PrincipalCell({ binding }: { binding: Binding }) {
  if (binding.userId) {
    return (
      <HStack gap={2}>
        <RandomColorAvatar
          id={binding.userId}
          name={binding.userName ?? binding.userEmail ?? "?"}
          size="xs"
        />
        <VStack gap={0} align="start">
          {binding.userName && (
            <Text fontWeight="medium" fontSize="sm">
              {binding.userName}
            </Text>
          )}
          <Text fontSize="xs" color="fg.muted">
            {binding.userEmail ?? ""}
          </Text>
        </VStack>
      </HStack>
    );
  }

  if (binding.groupId) {
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
            {binding.groupName ?? "Unknown group"}
          </Text>
          {binding.groupScimSource && (
            <Badge size="xs" colorPalette="blue">
              {binding.groupScimSource.toUpperCase()}
            </Badge>
          )}
        </VStack>
      </HStack>
    );
  }

  return (
    <Text color="fg.subtle" fontSize="sm">
      —
    </Text>
  );
}

// ── Scope cell ────────────────────────────────────────────────────────────────

function ScopeCell({ binding }: { binding: Binding }) {
  return (
    <HStack gap={2}>
      <Badge colorPalette={scopePillColor(binding.scopeType)} size="sm">
        {scopeLabel(binding.scopeType)}
      </Badge>
      {binding.scopeType !== RoleBindingScopeType.ORGANIZATION && (
        <Text fontSize="sm" color="fg.muted">
          {binding.scopeName ?? binding.scopeId.slice(0, 12) + "…"}
        </Text>
      )}
    </HStack>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

const FILTERS: { label: string; value: ScopeFilter }[] = [
  { label: "All", value: "ALL" },
  { label: "Org", value: RoleBindingScopeType.ORGANIZATION },
  { label: "Team", value: RoleBindingScopeType.TEAM },
  { label: "Project", value: RoleBindingScopeType.PROJECT },
];

function FilterBar({
  active,
  onChange,
}: {
  active: ScopeFilter;
  onChange: (f: ScopeFilter) => void;
}) {
  return (
    <HStack gap={1}>
      {FILTERS.map((f) => (
        <Button
          key={f.value}
          size="sm"
          variant={active === f.value ? "subtle" : "ghost"}
          colorPalette={active === f.value ? "blue" : "gray"}
          onClick={() => onChange(f.value)}
        >
          {f.label}
        </Button>
      ))}
    </HStack>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function AccessAuditPage() {
  const { organization } = useOrganizationTeamProject();
  const { isEnterprise, isLoading: isPlanLoading } = useActivePlan();
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("ALL");

  const { data: bindings, isLoading } = api.roleBinding.listForOrg.useQuery(
    { organizationId: organization?.id ?? "" },
    { enabled: !!organization?.id && isEnterprise },
  );

  if (isPlanLoading || !organization) {
    return (
      <SettingsLayout>
        <Spinner />
      </SettingsLayout>
    );
  }

  if (!isEnterprise) {
    return (
      <SettingsLayout>
        <VStack gap={6} align="start" width="full">
          <Box width="full">
            <ContactSalesBlock />
          </Box>
        </VStack>
      </SettingsLayout>
    );
  }

  const filtered =
    scopeFilter === "ALL"
      ? (bindings ?? [])
      : (bindings ?? []).filter((b) => b.scopeType === scopeFilter);

  return (
    <SettingsLayout>
      <VStack align="start" gap={6} width="full">
        <HStack justify="space-between" width="full">
          <VStack align="start" gap={1}>
            <Heading as="h2">Access Audit</Heading>
            <Text color="fg.muted" fontSize="sm">
              All role bindings in this organization.
            </Text>
          </VStack>
          <Spacer />
          {bindings && (
            <Text fontSize="sm" color="fg.muted">
              {filtered.length} binding{filtered.length !== 1 ? "s" : ""}
            </Text>
          )}
        </HStack>

        <Separator />

        <HStack justify="space-between" width="full">
          <FilterBar active={scopeFilter} onChange={setScopeFilter} />
        </HStack>

        <Card.Root width="full" overflow="hidden">
          <Card.Body paddingY={0} paddingX={0}>
            {isLoading ? (
              <Box padding={8} display="flex" justifyContent="center">
                <Spinner />
              </Box>
            ) : filtered.length === 0 ? (
              <Box padding={8} textAlign="center">
                <Text color="fg.muted">No role bindings found.</Text>
              </Box>
            ) : (
              <Table.Root variant="line" size="md" width="full">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>Who</Table.ColumnHeader>
                    <Table.ColumnHeader>Role</Table.ColumnHeader>
                    <Table.ColumnHeader>Scope</Table.ColumnHeader>
                    <Table.ColumnHeader>Added</Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {filtered.map((binding) => (
                    <Table.Row key={binding.id}>
                      <Table.Cell>
                        <PrincipalCell binding={binding} />
                      </Table.Cell>
                      <Table.Cell>
                        <Badge colorPalette={roleBadgeColor(binding.role)} size="sm">
                          {binding.customRoleName ?? binding.role}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell>
                        <ScopeCell binding={binding} />
                      </Table.Cell>
                      <Table.Cell>
                        <Text fontSize="sm" color="fg.muted">
                          {new Date(binding.createdAt).toLocaleDateString()}
                        </Text>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            )}
          </Card.Body>
        </Card.Root>
      </VStack>
    </SettingsLayout>
  );
}

export default withPermissionGuard("organization:view", {
  layoutComponent: SettingsLayout,
})(AccessAuditPage);
