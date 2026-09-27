import {
  Badge,
  Box,
  Button,
  createListCollection,
  HStack,
  Input,
  Spacer,
  Text,
} from "@chakra-ui/react";
import { teamUserRoleSchema } from "@langwatch/authz-contract";
import { InputGroup } from "@langwatch/design-system/input-group";
import { Select } from "@langwatch/design-system/select";
import { Search, X } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";

import { api } from "../../behavior/organization-api.ts";
import { useOrganizationToaster, useShowErrorToast } from "../../behavior/organization-feedback.ts";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project.ts";
import {
  getDefaultTeamRoleForOrganizationRole,
  isBindingRoleAllowedForOrganizationRole,
  type TeamRoleValue,
} from "../../model/member-role-constraints.ts";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "../../model/prisma-types.ts";

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

type LabelledItem = { label: string; value: string };

function filterByLabel({ items, search }: { items: LabelledItem[]; search: string }) {
  if (!search) return items;
  const needle = search.toLowerCase();
  return items.filter((item) => item.label.toLowerCase().includes(needle));
}

/** A `CUSTOM:<id>` picker value names a custom role; any other value names none. */
function customRoleIdOfValue(value: string): string | undefined {
  return value.startsWith("CUSTOM:") ? value.slice("CUSTOM:".length) : undefined;
}

export type PendingBinding = {
  roleValue: string;
  role: TeamUserRole;
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

const BASE_ROLE_ITEMS = [
  {
    label: "Admin",
    value: "ADMIN",
    customRoleId: undefined as string | undefined,
  },
  {
    label: "Member",
    value: "MEMBER",
    customRoleId: undefined as string | undefined,
  },
  {
    label: "Viewer",
    value: "VIEWER",
    customRoleId: undefined as string | undefined,
  },
];

/** The roles a row may offer, given the seat of the member it is written for. */
function roleItemsForSeat({
  customRoles,
  organizationRole,
}: {
  customRoles: { id: string; name: string }[];
  organizationRole?: OrganizationUserRole;
}) {
  const items = [
    ...BASE_ROLE_ITEMS,
    ...customRoles.map((r) => ({
      label: r.name,
      value: `CUSTOM:${r.id}`,
      customRoleId: r.id,
    })),
  ];
  if (!organizationRole) return items;
  return items.filter((item) =>
    isBindingRoleAllowedForOrganizationRole({
      organizationRole,
      role: (item.customRoleId ? `custom:${item.customRoleId}` : item.value) as TeamRoleValue,
    }),
  );
}

/** The role a fresh row starts from: the seat's default, or Member without one. */
function defaultRoleValueFor(organizationRole?: OrganizationUserRole): string {
  return organizationRole
    ? getDefaultTeamRoleForOrganizationRole(organizationRole)
    : TeamUserRole.MEMBER;
}

/** A Lite Member seat has no organization-scoped rows, so the scope goes too. */
function scopeTypeItemsForSeat(organizationRole?: OrganizationUserRole) {
  return organizationRole === OrganizationUserRole.EXTERNAL
    ? SCOPE_TYPE_ITEMS.filter((item) => item.value !== RoleBindingScopeType.ORGANIZATION)
    : SCOPE_TYPE_ITEMS;
}

function scopeNameFor({
  scopeType,
  scopeId,
  organizationName,
  teamItems,
  projectItems,
}: {
  scopeType: RoleBindingScopeType;
  scopeId: string;
  organizationName: string | undefined;
  teamItems: { label: string; value: string }[];
  projectItems: { label: string; value: string }[];
}): string | undefined {
  if (scopeType === RoleBindingScopeType.ORGANIZATION) return organizationName ?? "Organization";
  if (scopeType === RoleBindingScopeType.TEAM)
    return teamItems.find((t) => t.value === scopeId)?.label;
  return projectItems.find((p) => p.value === scopeId)?.label;
}

/**
 * A seat switched to Lite Member mid-edit takes the picker with it: a
 * selection now above the seat snaps to Viewer, and an organization scope
 * in progress falls back to team.
 */
function pickerSnapForSeat({
  organizationRole,
  roleValue,
  customRoleId,
  scopeType,
}: {
  organizationRole?: OrganizationUserRole;
  roleValue: string;
  customRoleId?: string;
  scopeType: RoleBindingScopeType;
}): { snapRoleToViewer: boolean; snapScopeToTeam: boolean } {
  if (!organizationRole) {
    return { snapRoleToViewer: false, snapScopeToTeam: false };
  }
  const selectionAllowed = isBindingRoleAllowedForOrganizationRole({
    organizationRole,
    role: (customRoleId ? `custom:${customRoleId}` : roleValue) as TeamRoleValue,
  });
  return {
    snapRoleToViewer: !selectionAllowed,
    snapScopeToTeam:
      organizationRole === OrganizationUserRole.EXTERNAL &&
      scopeType === RoleBindingScopeType.ORGANIZATION,
  };
}

// ── BindingInputRow ───────────────────────────────────────────────────────────

export type BindingInputRowHandle = {
  /** Return uncommitted binding if valid, else null. Resets the row. */
  flush: () => PendingBinding | null;
};

export const BindingInputRow = forwardRef<
  BindingInputRowHandle,
  {
    organizationId: string;
    onAdd: (binding: PendingBinding) => void;
    /**
     * Reports whether the row currently holds a complete, addable draft. The
     * dialog counts that draft as a pending change, so Save works on a row
     * the admin picked but never pressed Add on — the save flushes it.
     */
    onReadyChange?: (isReady: boolean) => void;
    /**
     * The seat of the member these rows are written for. A Lite Member seat
     * offers the Viewer role only, no custom roles, no organization scope.
     * Group editors pass nothing — a group has no seat, so every role stays available.
     */
    organizationRole?: OrganizationUserRole;
    buttonLabel?: string;
    isPending?: boolean;
  }
>(function BindingInputRow(
  {
    organizationId,
    onAdd,
    onReadyChange,
    organizationRole,
    buttonLabel = "Add",
    isPending = false,
  },
  ref,
) {
  const defaultRoleValue = defaultRoleValueFor(organizationRole);

  const [scopeType, setScopeType] = useState<RoleBindingScopeType>(RoleBindingScopeType.TEAM);
  const [scopeId, setScopeId] = useState("");
  const [roleValue, setRoleValue] = useState(defaultRoleValue);
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

  const roleItems = useMemo(
    () =>
      roleItemsForSeat({
        customRoles: customRoles.data ?? [],
        organizationRole,
      }),
    [customRoles.data, organizationRole],
  );
  const roleCollection = useMemo(() => createListCollection({ items: roleItems }), [roleItems]);

  const scopeTypeItems = useMemo(() => scopeTypeItemsForSeat(organizationRole), [organizationRole]);
  const scopeTypeCollection = useMemo(
    () => createListCollection({ items: scopeTypeItems }),
    [scopeTypeItems],
  );

  useEffect(() => {
    const snap = pickerSnapForSeat({
      organizationRole,
      roleValue,
      customRoleId,
      scopeType,
    });
    if (snap.snapRoleToViewer) {
      setRoleValue(TeamUserRole.VIEWER);
      setCustomRoleId(undefined);
    }
    if (snap.snapScopeToTeam) {
      setScopeType(RoleBindingScopeType.TEAM);
      setScopeId("");
    }
  }, [organizationRole, roleValue, customRoleId, scopeType]);

  const allTeamItems = useMemo(
    () => (teams.data ?? []).map((t) => ({ label: t.name, value: t.id })),
    [teams.data],
  );
  const teamItems = useMemo(
    () => filterByLabel({ items: allTeamItems, search: teamSearch }),
    [allTeamItems, teamSearch],
  );
  const teamCollection = useMemo(() => createListCollection({ items: teamItems }), [teamItems]);

  // For project cascade: teams that have at least one project
  const allProjectTeamItems = useMemo(
    () =>
      (teams.data ?? [])
        .filter((t) => t.projects.length > 0)
        .map((t) => ({ label: t.name, value: t.id })),
    [teams.data],
  );
  const projectTeamItems = useMemo(
    () => filterByLabel({ items: allProjectTeamItems, search: projectTeamSearch }),
    [allProjectTeamItems, projectTeamSearch],
  );
  const projectTeamCollection = useMemo(
    () => createListCollection({ items: projectTeamItems }),
    [projectTeamItems],
  );

  // Projects filtered to the selected team
  const allProjectItems = useMemo(
    () =>
      (teams.data ?? [])
        .find((t) => t.id === projectTeamId)
        ?.projects.map((p) => ({ label: p.name, value: p.id })) ?? [],
    [teams.data, projectTeamId],
  );
  const projectItems = useMemo(
    () => filterByLabel({ items: allProjectItems, search: projectSearch }),
    [allProjectItems, projectSearch],
  );
  const projectCollection = useMemo(
    () => createListCollection({ items: projectItems }),
    [projectItems],
  );

  const isReady = isDirty && (scopeId !== "" || scopeType === RoleBindingScopeType.ORGANIZATION);

  useEffect(() => {
    onReadyChange?.(isReady);
  }, [isReady, onReadyChange]);

  function buildBinding(): PendingBinding {
    const cid = customRoleId;
    const cname = cid ? customRoles.data?.find((r) => r.id === cid)?.name : undefined;
    return {
      roleValue,
      role: cid ? TeamUserRole.CUSTOM : teamUserRoleSchema.parse(roleValue),
      customRoleId: cid,
      customRoleName: cname,
      scopeType,
      scopeId: scopeType === RoleBindingScopeType.ORGANIZATION ? organizationId : scopeId,
      scopeName: scopeNameFor({
        scopeType,
        scopeId,
        organizationName: organization?.name,
        teamItems: allTeamItems,
        projectItems: allProjectItems,
      }),
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
          const v = e.value[0] ?? defaultRoleValue;
          setRoleValue(v);
          setCustomRoleId(customRoleIdOfValue(v));
          setIsDirty(true);
        }}
        size="sm"
        width="160px"
      >
        <Select.Trigger>
          <Select.ValueText placeholder="Role..." />
        </Select.Trigger>
        <Select.Content>
          {roleItems.map((item) => (
            <Select.Item key={item.value} item={item}>
              {item.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>

      <Text fontSize="sm" color="fg.muted">
        on
      </Text>

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
        <Select.Trigger>
          <Select.ValueText />
        </Select.Trigger>
        <Select.Content>
          {scopeTypeItems.map((item) => (
            <Select.Item key={item.value} item={item}>
              {item.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>

      {scopeType === RoleBindingScopeType.TEAM && (
        <Select.Root
          collection={teamCollection}
          value={scopeId ? [scopeId] : []}
          onValueChange={(e) => {
            setScopeId(e.value[0] ?? "");
            setIsDirty(true);
          }}
          size="sm"
          width="160px"
        >
          <Select.Trigger>
            <Select.ValueText placeholder="Select team..." />
          </Select.Trigger>
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
              <Select.Item key={item.value} item={item}>
                {item.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      )}

      {scopeType === RoleBindingScopeType.ORGANIZATION && (
        <Text fontSize="sm" color="fg.muted" minWidth="160px">
          (whole organization)
        </Text>
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
            <Select.Trigger>
              <Select.ValueText placeholder="Select team..." />
            </Select.Trigger>
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
                <Select.Item key={item.value} item={item}>
                  {item.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>

          {projectTeamId && (
            <Select.Root
              collection={projectCollection}
              value={scopeId ? [scopeId] : []}
              onValueChange={(e) => {
                setScopeId(e.value[0] ?? "");
                setIsDirty(true);
              }}
              size="sm"
              width="160px"
            >
              <Select.Trigger>
                <Select.ValueText placeholder="Select project..." />
              </Select.Trigger>
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
                  <Select.Item key={item.value} item={item}>
                    {item.label}
                  </Select.Item>
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
  const toaster = useOrganizationToaster();
  const showErrorToast = useShowErrorToast();
  const addBinding = api.group.addBinding.useMutation({
    onSuccess: () => {
      toaster.create({ title: "Binding added", type: "success" });
      onAdded();
    },
    onError: (e) => showErrorToast({ error: e, fallbackTitle: "Couldn't add the binding" }),
  });

  return (
    <BindingInputRow
      organizationId={organizationId}
      isPending={addBinding.isPending}
      onAdd={(b) =>
        addBinding.mutate({
          organizationId,
          groupId,
          role: b.role,
          customRoleId: b.customRoleId,
          scopeType: b.scopeType,
          scopeId: b.scopeId,
        })
      }
    />
  );
}

export type BindingRowShape = {
  role: string;
  customRoleName?: string | null;
  scopeType: RoleBindingScopeType;
  scopeId: string;
  scopeName?: string | null;
};

export function toggled({ set, id }: { set: ReadonlySet<string>; id: string }): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function DirectBindingRow({
  binding,
  markedForRemoval,
  removable,
  onToggle,
}: {
  binding: BindingRowShape;
  markedForRemoval: boolean;
  removable: boolean;
  onToggle: () => void;
}) {
  const strike = markedForRemoval ? "line-through" : undefined;
  return (
    <HStack
      px={3}
      py={2}
      bg="bg.muted"
      borderRadius="md"
      fontSize="sm"
      opacity={markedForRemoval ? 0.4 : 1}
      transition="opacity 0.15s"
    >
      <Badge colorPalette={roleBadgeColor(binding.role)} size="sm" textDecoration={strike}>
        {binding.customRoleName ?? binding.role}
      </Badge>
      <Text color="fg.muted">on</Text>
      <Badge colorPalette="purple" size="sm" textDecoration={strike}>
        {scopeTypeLabel(binding.scopeType)} {binding.scopeName ?? binding.scopeId}
      </Badge>
      <Spacer />
      {removable && (
        <Button
          size="xs"
          variant="ghost"
          color={markedForRemoval ? "blue.500" : "fg.muted"}
          aria-label={markedForRemoval ? "Undo removal" : "Remove binding"}
          onClick={onToggle}
        >
          <X size={14} />
        </Button>
      )}
    </HStack>
  );
}

export function StagedBindingRow({
  binding,
  onUndo,
}: {
  binding: PendingBinding;
  onUndo: () => void;
}) {
  return (
    <HStack px={3} py={2} bg="bg.muted" borderRadius="md" fontSize="sm" opacity={0.7}>
      <Badge colorPalette={roleBadgeColor(binding.role)} size="sm">
        {binding.customRoleName ?? binding.role}
      </Badge>
      <Text color="fg.muted">on</Text>
      <Badge colorPalette="purple" size="sm">
        {scopeTypeLabel(binding.scopeType)} {binding.scopeName ?? binding.scopeId}
      </Badge>
      <Spacer />
      <Button size="xs" variant="ghost" color="fg.muted" aria-label="Undo add" onClick={onUndo}>
        <X size={14} />
      </Button>
    </HStack>
  );
}
