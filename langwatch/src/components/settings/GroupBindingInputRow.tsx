import {
  Badge,
  Box,
  Button,
  createListCollection,
  HStack,
  Input,
  Text,
} from "@chakra-ui/react";
import { RoleBindingScopeType } from "@prisma/client";
import { Search } from "lucide-react";
import { forwardRef, useImperativeHandle, useState } from "react";
import { InputGroup } from "~/components/ui/input-group";
import { Select } from "~/components/ui/select";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

// ── Shared display helpers ────────────────────────────────────────────────────

export function scopeTypeLabel(type: RoleBindingScopeType) {
  if (type === RoleBindingScopeType.ORGANIZATION) return "🏢";
  if (type === RoleBindingScopeType.TEAM) return "👥";
  return "📁";
}

export function roleBadgeColor(role: string) {
  if (role === "ADMIN") return "red";
  if (role === "MEMBER") return "blue";
  return "gray";
}

export function SourceBadge({ scimSource }: { scimSource: string | null }) {
  if (!scimSource) return <Badge colorPalette="gray">Manual</Badge>;
  return <Badge colorPalette="blue">{scimSource.toUpperCase()}</Badge>;
}

// ── Types + constants ─────────────────────────────────────────────────────────

export type PendingBinding = {
  roleValue: string;
  role: string;
  customRoleId?: string;
  customRoleName?: string;
  scopeType: RoleBindingScopeType;
  scopeId: string;
  scopeName?: string;
};

const SCOPE_TYPE_ITEMS = [
  { label: "Organization", value: RoleBindingScopeType.ORGANIZATION },
  { label: "Team", value: RoleBindingScopeType.TEAM },
  { label: "Project", value: RoleBindingScopeType.PROJECT },
];
const scopeTypeCollection = createListCollection({ items: SCOPE_TYPE_ITEMS });

const BASE_ROLE_ITEMS = [
  { label: "Admin", value: "ADMIN", customRoleId: undefined as string | undefined },
  { label: "Member", value: "MEMBER", customRoleId: undefined as string | undefined },
  { label: "Viewer", value: "VIEWER", customRoleId: undefined as string | undefined },
];

// ── BindingInputRow ───────────────────────────────────────────────────────────

export type BindingInputRowHandle = {
  /** Return the uncommitted binding if all required fields are filled, otherwise null. Resets the row. */
  flush: () => PendingBinding | null;
};

export const BindingInputRow = forwardRef<
  BindingInputRowHandle,
  {
    organizationId: string;
    onAdd: (binding: PendingBinding) => void;
    buttonLabel?: string;
    isPending?: boolean;
  }
>(function BindingInputRow({
  organizationId,
  onAdd,
  buttonLabel = "Add",
  isPending = false,
}, ref) {
  const [scopeType, setScopeType] = useState<RoleBindingScopeType>(RoleBindingScopeType.TEAM);
  const [scopeId, setScopeId] = useState("");
  const [roleValue, setRoleValue] = useState("MEMBER");
  const [customRoleId, setCustomRoleId] = useState<string | undefined>(undefined);
  const [teamSearch, setTeamSearch] = useState("");
  const [projectTeamId, setProjectTeamId] = useState("");
  const [projectTeamSearch, setProjectTeamSearch] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  // True only when the user has changed something since the last add/flush
  const [isDirty, setIsDirty] = useState(false);

  const { organization } = useOrganizationTeamProject();
  const teams = api.team.getTeamsWithMembers.useQuery({ organizationId });
  const customRoles = api.role.getAll.useQuery({ organizationId });

  const roleItems = [
    ...BASE_ROLE_ITEMS,
    ...(customRoles.data ?? []).map((r) => ({
      label: r.name,
      value: `CUSTOM:${r.id}`,
      customRoleId: r.id,
    })),
  ];
  const roleCollection = createListCollection({ items: roleItems });

  const allTeamItems = (teams.data ?? []).map((t) => ({ label: t.name, value: t.id }));
  const teamItems = teamSearch
    ? allTeamItems.filter((t) => t.label.toLowerCase().includes(teamSearch.toLowerCase()))
    : allTeamItems;
  const teamCollection = createListCollection({ items: teamItems });

  // For project cascade: teams that have at least one project
  const allProjectTeamItems = (teams.data ?? [])
    .filter((t) => t.projects.length > 0)
    .map((t) => ({ label: t.name, value: t.id }));
  const projectTeamItems = projectTeamSearch
    ? allProjectTeamItems.filter((t) => t.label.toLowerCase().includes(projectTeamSearch.toLowerCase()))
    : allProjectTeamItems;
  const projectTeamCollection = createListCollection({ items: projectTeamItems });

  // Projects filtered to the selected team
  const allProjectItems = (teams.data ?? [])
    .find((t) => t.id === projectTeamId)
    ?.projects.map((p) => ({ label: p.name, value: p.id })) ?? [];
  const projectItems = projectSearch
    ? allProjectItems.filter((p) => p.label.toLowerCase().includes(projectSearch.toLowerCase()))
    : allProjectItems;
  const projectCollection = createListCollection({ items: projectItems });

  function getScopeName() {
    if (scopeType === RoleBindingScopeType.ORGANIZATION) return organization?.name ?? "Organization";
    if (scopeType === RoleBindingScopeType.TEAM)
      return allTeamItems.find((t) => t.value === scopeId)?.label;
    if (scopeType === RoleBindingScopeType.PROJECT)
      return allProjectItems.find((p) => p.value === scopeId)?.label;
    return undefined;
  }

  const isReady =
    isDirty && (scopeId !== "" || scopeType === RoleBindingScopeType.ORGANIZATION);

  function buildBinding(): PendingBinding {
    const cid = customRoleId;
    const cname = cid ? customRoles.data?.find((r) => r.id === cid)?.name : undefined;
    return {
      roleValue,
      role: cid ? "CUSTOM" : roleValue,
      customRoleId: cid,
      customRoleName: cname,
      scopeType,
      scopeId: scopeType === RoleBindingScopeType.ORGANIZATION ? organizationId : scopeId,
      scopeName: getScopeName(),
    };
  }

  function resetRow() {
    setScopeId("");
    setProjectTeamId("");
    setProjectTeamSearch("");
    setIsDirty(false);
  }

  function handleAdd() {
    if (!isReady) return;
    onAdd(buildBinding());
    resetRow();
  }

  useImperativeHandle(ref, () => ({
    flush() {
      if (!isReady) return null;
      const binding = buildBinding();
      resetRow();
      return binding;
    },
  }));

  return (
    <HStack gap={2} mt={2} flexWrap="wrap">
      <Select.Root
        collection={roleCollection}
        value={[roleValue]}
        onValueChange={(e) => {
          const v = e.value[0] ?? "MEMBER";
          if (v.startsWith("CUSTOM:")) {
            setRoleValue(v);
            setCustomRoleId(v.slice(7));
          } else {
            setRoleValue(v);
            setCustomRoleId(undefined);
          }
          setIsDirty(true);
        }}
        size="sm"
        width="160px"
      >
        <Select.Trigger><Select.ValueText placeholder="Role..." /></Select.Trigger>
        <Select.Content>
          {roleItems.map((item) => (
            <Select.Item key={item.value} item={item}>{item.label}</Select.Item>
          ))}
        </Select.Content>
      </Select.Root>

      <Text fontSize="sm" color="fg.muted">on</Text>

      <Select.Root
        collection={scopeTypeCollection}
        value={[scopeType]}
        onValueChange={(e) => {
          setScopeType((e.value[0] as RoleBindingScopeType) ?? RoleBindingScopeType.TEAM);
          setScopeId("");
          setTeamSearch("");
          setProjectTeamId("");
          setProjectTeamSearch("");
          setProjectSearch("");
          setIsDirty(true);
        }}
        size="sm"
        width="130px"
      >
        <Select.Trigger><Select.ValueText /></Select.Trigger>
        <Select.Content>
          {SCOPE_TYPE_ITEMS.map((item) => (
            <Select.Item key={item.value} item={item}>{item.label}</Select.Item>
          ))}
        </Select.Content>
      </Select.Root>

      {scopeType === RoleBindingScopeType.TEAM && (
        <Select.Root
          collection={teamCollection}
          value={scopeId ? [scopeId] : []}
          onValueChange={(e) => { setScopeId(e.value[0] ?? ""); setIsDirty(true); }}
          size="sm"
          width="160px"
        >
          <Select.Trigger><Select.ValueText placeholder="Select team..." /></Select.Trigger>
          <Select.Content>
            <Box position="sticky" top={0} zIndex={1} bg="bg" pb={1}>
              <InputGroup startElement={<Search size={14} />} startOffset="2px" width="full">
                <Input
                  size="sm"
                  placeholder="Search teams..."
                  value={teamSearch}
                  onChange={(e) => setTeamSearch(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </InputGroup>
            </Box>
            {teamItems.map((item) => (
              <Select.Item key={item.value} item={item}>{item.label}</Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      )}

      {scopeType === RoleBindingScopeType.ORGANIZATION && (
        <Text fontSize="sm" color="fg.muted" minWidth="160px">(whole organization)</Text>
      )}

      {scopeType === RoleBindingScopeType.PROJECT && (
        <>
          <Select.Root
            collection={projectTeamCollection}
            value={projectTeamId ? [projectTeamId] : []}
            onValueChange={(e) => {
              setProjectTeamId(e.value[0] ?? "");
              setScopeId("");
              setProjectSearch("");
            }}
            size="sm"
            width="160px"
          >
            <Select.Trigger><Select.ValueText placeholder="Select team..." /></Select.Trigger>
            <Select.Content>
              <Box position="sticky" top={0} zIndex={1} bg="bg" pb={1}>
                <InputGroup startElement={<Search size={14} />} startOffset="2px" width="full">
                  <Input
                    size="sm"
                    placeholder="Search teams..."
                    value={projectTeamSearch}
                    onChange={(e) => setProjectTeamSearch(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </InputGroup>
              </Box>
              {projectTeamItems.map((item) => (
                <Select.Item key={item.value} item={item}>{item.label}</Select.Item>
              ))}
            </Select.Content>
          </Select.Root>

          {projectTeamId && (
            <Select.Root
              collection={projectCollection}
              value={scopeId ? [scopeId] : []}
              onValueChange={(e) => { setScopeId(e.value[0] ?? ""); setIsDirty(true); }}
              size="sm"
              width="160px"
            >
              <Select.Trigger><Select.ValueText placeholder="Select project..." /></Select.Trigger>
              <Select.Content>
                <Box position="sticky" top={0} zIndex={1} bg="bg" pb={1}>
                  <InputGroup startElement={<Search size={14} />} startOffset="2px" width="full">
                    <Input
                      size="sm"
                      placeholder="Search projects..."
                      value={projectSearch}
                      onChange={(e) => setProjectSearch(e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                  </InputGroup>
                </Box>
                {projectItems.map((item) => (
                  <Select.Item key={item.value} item={item}>{item.label}</Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          )}
        </>
      )}

      <Button
        size="sm"
        colorPalette={isReady ? "blue" : undefined}
        disabled={!isReady}
        loading={isPending}
        onClick={handleAdd}
      >
        {buttonLabel}
      </Button>
    </HStack>
  );
});

// ── AddBindingForm ────────────────────────────────────────────────────────────

export function AddBindingForm({
  organizationId,
  groupId,
  onAdded,
}: {
  organizationId: string;
  groupId: string;
  onAdded: () => void;
}) {
  const addBinding = api.group.addBinding.useMutation({
    onSuccess: () => {
      toaster.create({ title: "Binding added", type: "success" });
      onAdded();
    },
    onError: (e) => toaster.create({ title: e.message, type: "error" }),
  });

  return (
    <BindingInputRow
      organizationId={organizationId}
      isPending={addBinding.isPending}
      onAdd={(b) =>
        addBinding.mutate({
          organizationId,
          groupId,
          role: b.role as any,
          customRoleId: b.customRoleId,
          scopeType: b.scopeType,
          scopeId: b.scopeId,
        })
      }
    />
  );
}
