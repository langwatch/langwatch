import {
  Badge,
  Box,
  Card,
  Code,
  Heading,
  HStack,
  Separator,
  Spacer,
  Spinner,
  Table,
  Text,
  Button,
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

// ── Group bindings by principal ───────────────────────────────────────────────

type Principal = {
  key: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  groupId: string | null;
  groupName: string | null;
  groupScimSource: string | null;
  bindings: Binding[];
};

function groupByPrincipal(bindings: Binding[]): Principal[] {
  const map = new Map<string, Principal>();

  for (const b of bindings) {
    const key = b.userId ?? b.groupId ?? "unknown";
    if (!map.has(key)) {
      map.set(key, {
        key,
        userId: b.userId,
        userName: b.userName,
        userEmail: b.userEmail,
        groupId: b.groupId,
        groupName: b.groupName,
        groupScimSource: b.groupScimSource,
        bindings: [],
      });
    }
    map.get(key)!.bindings.push(b);
  }

  return [...map.values()].sort((a, b) => {
    const nameA = a.userName ?? a.groupName ?? a.userEmail ?? "";
    const nameB = b.userName ?? b.groupName ?? b.userEmail ?? "";
    return nameA.localeCompare(nameB);
  });
}

// ── Principal cell ────────────────────────────────────────────────────────────

function PrincipalCell({ principal }: { principal: Principal }) {
  if (principal.userId) {
    return (
      <HStack gap={2}>
        <RandomColorAvatar
          id={principal.userId}
          name={principal.userName ?? principal.userEmail ?? "?"}
          size="xs"
        />
        <VStack gap={0} align="start">
          {principal.userName && (
            <Text fontWeight="medium" fontSize="sm">{principal.userName}</Text>
          )}
          <Text fontSize="xs" color="fg.muted">{principal.userEmail ?? ""}</Text>
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

// ── Bindings cell ─────────────────────────────────────────────────────────────

function BindingsCell({ bindings }: { bindings: Binding[] }) {
  return (
    <VStack gap={1} align="end">
      {bindings.map((b) => (
        <HStack key={b.id} gap={1}>
          <Badge colorPalette={roleBadgeColor(b.role)} size="sm">
            {b.customRoleName ?? b.role}
          </Badge>
          <Text fontSize="xs" color="fg.muted">on</Text>
          <Badge colorPalette={scopePillColor(b.scopeType)} size="sm">
            {scopeLabel(b.scopeType)} · {b.scopeName ?? b.scopeId.slice(0, 8) + "…"}
          </Badge>
        </HStack>
      ))}
    </VStack>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

const FILTERS: { label: string; value: ScopeFilter }[] = [
  { label: "All", value: "ALL" },
  { label: "Org", value: RoleBindingScopeType.ORGANIZATION },
  { label: "Team", value: RoleBindingScopeType.TEAM },
  { label: "Project", value: RoleBindingScopeType.PROJECT },
];

function FilterBar({ active, onChange }: { active: ScopeFilter; onChange: (f: ScopeFilter) => void }) {
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
    return <SettingsLayout><Spinner /></SettingsLayout>;
  }

  if (!isEnterprise) {
    return (
      <SettingsLayout>
        <Box width="full"><ContactSalesBlock /></Box>
      </SettingsLayout>
    );
  }

  const filtered =
    scopeFilter === "ALL"
      ? (bindings ?? [])
      : (bindings ?? []).filter((b) => b.scopeType === scopeFilter);

  const principals = groupByPrincipal(filtered);

  return (
    <SettingsLayout>
      <VStack align="start" gap={6} width="full">
        <VStack align="start" gap={1} width="full">
          <Heading as="h2">Access Audit</Heading>
          <Text color="fg.muted" fontSize="sm">
            All role bindings in this organization.
          </Text>
        </VStack>

        <Separator />

        <HStack width="full">
          <FilterBar active={scopeFilter} onChange={setScopeFilter} />
          <Spacer />
          {bindings && (
            <Text fontSize="sm" color="fg.muted">
              {principals.length} {principals.length === 1 ? "principal" : "principals"}
            </Text>
          )}
        </HStack>

        <Card.Root width="full" overflow="hidden">
          <Card.Body paddingY={0} paddingX={0}>
            {isLoading ? (
              <Box padding={8} display="flex" justifyContent="center"><Spinner /></Box>
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
                  {principals.map((p) => (
                    <Table.Row key={p.key}>
                      <Table.Cell>
                        <PrincipalCell principal={p} />
                      </Table.Cell>
                      <Table.Cell>
                        <BindingsCell bindings={p.bindings} />
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            )}
          </Card.Body>
        </Card.Root>

        <RbacDebugBookmarklets />
      </VStack>
    </SettingsLayout>
  );
}

function RbacDebugBookmarklets() {
  return (
    <HStack gap={2} paddingTop={2} flexWrap="wrap" alignItems="center">
      <Text fontSize="xs" color="fg.subtle">
        🔐 RBAC debug panel:
      </Text>
      <Text fontSize="xs" color="fg.subtle">
        load <Code fontSize="xs">langwatch/tools/rbac-debug-extension</Code> in Chrome (Developer mode → Load unpacked)
      </Text>
    </HStack>
  );
}

export default withPermissionGuard("organization:view", {
  layoutComponent: SettingsLayout,
})(AccessAuditPage);
