import {
  Badge,
  Box,
  Card,
  HStack,
  IconButton,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { RouterOutputs } from "~/utils/api";

const STORAGE_KEY = "lw_rbac_debug";

const scopeIcon = (scopeType: string) => {
  if (scopeType === "ORGANIZATION") return "🏢";
  if (scopeType === "TEAM") return "👥";
  return "📁";
};

const roleColor = (role: string) => {
  if (role === "ADMIN") return "red";
  if (role === "MEMBER") return "blue";
  if (role === "VIEWER") return "gray";
  if (role === "CUSTOM") return "purple";
  return "gray";
};

type DebugData = RouterOutputs["roleBinding"]["debugCurrentUser"];

function PermissionList({ permissions }: { permissions: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? permissions : permissions.slice(0, 4);
  return (
    <Box>
      <HStack flexWrap="wrap" gap={1}>
        {visible.map((p) => (
          <Badge key={p} size="xs" colorPalette="green" variant="subtle" fontSize="9px">
            {p}
          </Badge>
        ))}
        {permissions.length > 4 && (
          <Badge
            size="xs"
            colorPalette="gray"
            variant="subtle"
            cursor="pointer"
            fontSize="9px"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "show less" : `+${permissions.length - 4} more`}
          </Badge>
        )}
      </HStack>
    </Box>
  );
}

function BindingRow({
  binding,
  via,
}: {
  binding: DebugData["directBindings"][0];
  via?: string;
}) {
  return (
    <VStack align="start" gap={1} paddingLeft={via ? 4 : 0} paddingY={1} borderLeftWidth={via ? "2px" : 0} borderColor="border.muted">
      <HStack gap={1} flexWrap="wrap">
        <Text fontSize="xs" color="fg.muted">
          {scopeIcon(binding.scopeType)}
        </Text>
        <Badge colorPalette={roleColor(binding.role)} size="sm">
          {binding.customRoleName ?? binding.role}
        </Badge>
        <Text fontSize="xs" color="fg.muted">on</Text>
        <Text fontSize="xs" fontWeight="semibold">
          {binding.scopeName ?? binding.scopeId.slice(0, 8) + "…"}
        </Text>
        {via && (
          <Text fontSize="xs" color="fg.subtle">via {via}</Text>
        )}
      </HStack>
      <PermissionList permissions={binding.permissions} />
    </VStack>
  );
}

function Section({
  title,
  children,
  count,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  count?: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <VStack align="start" gap={1} width="full">
      <HStack
        width="full"
        cursor="pointer"
        onClick={() => setOpen(!open)}
        paddingY={1}
        borderBottomWidth="1px"
        borderColor="border.muted"
      >
        <Text fontSize="xs" fontWeight="bold" color="fg.subtle" textTransform="uppercase" letterSpacing="wider">
          {title}
        </Text>
        {count !== undefined && (
          <Badge size="xs" colorPalette="gray">{count}</Badge>
        )}
        <Spacer />
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </HStack>
      {open && <Box width="full" paddingLeft={1}>{children}</Box>}
    </VStack>
  );
}

function PanelContent({ organizationId }: { organizationId: string }) {
  const { team, project } = useOrganizationTeamProject();

  const { data, isLoading, isError } = api.roleBinding.debugCurrentUser.useQuery(
    { organizationId },
    { refetchOnWindowFocus: false },
  );

  const effectivePermissions = useMemo(() => {
    if (!data) return [];
    const all = new Set<string>();

    // Org role permissions always apply
    for (const p of data.user.orgRolePermissions) all.add(p);

    // Collect all bindings (direct + via groups)
    const allBindings = [
      ...data.directBindings,
      ...data.groups.flatMap((g) => g.bindings),
    ];

    for (const b of allBindings) {
      // Filter to current scope context if we have one
      if (project && b.scopeType === "PROJECT" && b.scopeId !== project.id) continue;
      if (team && b.scopeType === "TEAM" && b.scopeId !== team.id) continue;
      for (const p of b.permissions) all.add(p);
    }

    return [...all].sort();
  }, [data, team, project]);

  if (isLoading) return <Spinner size="sm" />;
  if (isError || !data) return <Text fontSize="xs" color="red.500">Failed to load RBAC data</Text>;

  const currentScopeLabel = project
    ? `📁 ${project.name}`
    : team
    ? `👥 ${team.name}`
    : "🏢 Organisation";

  return (
    <VStack align="start" gap={3} width="full">
      {/* User */}
      <VStack align="start" gap={1} width="full">
        <Text fontSize="sm" fontWeight="bold">{data.user.name ?? "Unknown"}</Text>
        <Text fontSize="xs" color="fg.muted">{data.user.email}</Text>
        <HStack gap={1}>
          <Text fontSize="xs" color="fg.subtle">Org role:</Text>
          <Badge colorPalette={roleColor(data.user.orgRole)} size="sm">
            {data.user.orgRole}
          </Badge>
        </HStack>
        <PermissionList permissions={data.user.orgRolePermissions} />
      </VStack>

      {/* Groups */}
      <Section title="Groups" count={data.groups.length} defaultOpen={data.groups.length > 0}>
        {data.groups.length === 0 ? (
          <Text fontSize="xs" color="fg.subtle">No group memberships</Text>
        ) : (
          <VStack align="start" gap={3} width="full">
            {data.groups.map((g) => (
              <VStack key={g.id} align="start" gap={1} width="full">
                <HStack gap={1}>
                  <Text fontSize="xs" fontWeight="semibold">{g.name}</Text>
                  {g.scimSource && (
                    <Badge size="xs" colorPalette="cyan" variant="subtle">{g.scimSource}</Badge>
                  )}
                  {g.bindings.length === 0 && (
                    <Text fontSize="xs" color="fg.subtle">(no bindings)</Text>
                  )}
                </HStack>
                {g.bindings.map((b) => (
                  <BindingRow key={b.id} binding={b} via={g.name} />
                ))}
              </VStack>
            ))}
          </VStack>
        )}
      </Section>

      {/* Direct Bindings */}
      <Section title="Direct Bindings" count={data.directBindings.length} defaultOpen={data.directBindings.length > 0}>
        {data.directBindings.length === 0 ? (
          <Text fontSize="xs" color="fg.subtle">No direct role bindings</Text>
        ) : (
          <VStack align="start" gap={2} width="full">
            {data.directBindings.map((b) => (
              <BindingRow key={b.id} binding={b} />
            ))}
          </VStack>
        )}
      </Section>

      {/* Effective permissions for current scope */}
      <Section title={`Effective Permissions — ${currentScopeLabel}`} defaultOpen>
        {effectivePermissions.length === 0 ? (
          <Text fontSize="xs" color="fg.subtle">No permissions</Text>
        ) : (
          <HStack flexWrap="wrap" gap={1}>
            {effectivePermissions.map((p) => (
              <Badge key={p} size="xs" colorPalette="green" variant="subtle" fontSize="9px">
                {p}
              </Badge>
            ))}
          </HStack>
        )}
      </Section>
    </VStack>
  );
}

export function RbacDebugPanel() {
  const [enabled, setEnabled] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const { organization } = useOrganizationTeamProject();

  useEffect(() => {
    setEnabled(localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  const disable = () => {
    localStorage.removeItem(STORAGE_KEY);
    setEnabled(false);
  };

  if (!enabled || !organization) return null;

  return (
    <Box
      position="fixed"
      bottom={4}
      right={4}
      zIndex={9999}
      width="420px"
      maxWidth="calc(100vw - 32px)"
    >
      <Card.Root
        shadow="2xl"
        borderWidth="2px"
        borderColor="orange.400"
        fontSize="sm"
      >
        <Card.Header paddingY={2} paddingX={3}>
          <HStack gap={2}>
            <Text fontSize="xs" fontWeight="bold">🔐 RBAC Debug</Text>
            <Text fontSize="xs" color="fg.muted" fontFamily="mono">
              {organization.name}
            </Text>
            <Spacer />
            <IconButton
              aria-label="Toggle panel"
              size="xs"
              variant="ghost"
              onClick={() => setCollapsed(!collapsed)}
            >
              {collapsed ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </IconButton>
            <IconButton
              aria-label="Disable RBAC debug"
              size="xs"
              variant="ghost"
              color="red.500"
              onClick={disable}
            >
              <X size={12} />
            </IconButton>
          </HStack>
        </Card.Header>
        {!collapsed && (
          <Card.Body
            paddingX={3}
            paddingY={2}
            paddingBottom={4}
            maxHeight="70vh"
            overflowY="auto"
          >
            <PanelContent organizationId={organization.id} />
          </Card.Body>
        )}
      </Card.Root>
    </Box>
  );
}
