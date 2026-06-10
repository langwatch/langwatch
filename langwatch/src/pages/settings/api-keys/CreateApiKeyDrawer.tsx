import {
  Button,
  createListCollection,
  Heading,
  HStack,
  Input,
  SegmentGroup,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { useSession } from "~/utils/auth-client";
import { useEffect, useMemo, useState } from "react";
import { Drawer } from "../../../components/ui/drawer";
import { Select } from "../../../components/ui/select";
import {
  ScopeChipPicker,
  type ScopeChipPickerEntry,
} from "../../../components/settings/ScopeChipPicker";
import type { RouterOutputs } from "../../../utils/api";
import { api } from "../../../utils/api";
import {
  computePermissionsFromSelections,
} from "../../../server/api-key/permission-categories";
import { getTeamRolePermissions } from "../../../server/api/rbac";
import { TeamUserRole } from "@prisma/client";
import {
  PermissionCategoryList,
  PermissionCounter,
  type PermissionSelection,
} from "./PermissionCategoryList";
import {
  deriveBindingRole,
  EXPIRATION_OPTIONS,
  expirationCollection,
  getUserPermissionsAtScope,
  type PermissionMode,
} from "./utils";

type MyBindingsData = RouterOutputs["apiKey"]["myBindings"];
type MyBindings = {
  data: MyBindingsData | undefined;
  isLoading: boolean;
};

type OrgProject = { id: string; name: string; teamId: string };
type OrgTeam = { id: string; name: string };

export type CreateApiKeyInput = {
  name: string;
  description: string;
  expiresAt: Date | undefined;
  permissionMode: PermissionMode;
  keyType: "personal" | "service";
  assignedToUserId?: string;
  scopeType: string;
  scopeId: string;
  permissions?: string[];
  bindings: Array<{
    role: string;
    scopeType: string;
    scopeId: string;
  }>;
};

export function CreateApiKeyDrawer({
  isOpen,
  isCreating,
  myBindings,
  orgProjects,
  orgTeams,
  organizationId,
  organizationName,
  currentTeamId,
  currentProjectId,
  onClose,
  onCreate,
}: {
  isOpen: boolean;
  isCreating: boolean;
  myBindings: MyBindings;
  orgProjects: OrgProject[];
  orgTeams: OrgTeam[];
  organizationId: string;
  organizationName: string | undefined;
  currentTeamId?: string;
  currentProjectId?: string;
  onClose: () => void;
  onCreate: (input: CreateApiKeyInput) => void;
}) {
  const session = useSession();
  const currentUserId = session.data?.user?.id ?? "";

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [expirationPreset, setExpirationPreset] = useState("");
  const [customDate, setCustomDate] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<ScopeChipPickerEntry[]>(
    [],
  );
  const [permissionMode, setPermissionMode] = useState<"all" | "restricted">(
    "all",
  );
  const [categorySelections, setCategorySelections] = useState<
    Record<string, PermissionSelection>
  >({});
  const [keyType, setKeyType] = useState<"personal" | "service">("personal");
  const [selectedUserId, setSelectedUserId] = useState("");

  const orgMembers = api.apiKey.orgMembers.useQuery(
    { organizationId },
    { enabled: isOpen },
  );
  const isAdmin = (orgMembers.data?.length ?? 0) > 0;

  const minCustomDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }, []);

  const memberCollection = useMemo(() => {
    const items = (orgMembers.data ?? []).map((m) => ({
      label: m.name ?? m.email ?? m.id,
      value: m.id,
    }));
    return createListCollection({ items });
  }, [orgMembers.data]);

  const primaryScope = selectedScopes[0] ?? {
    scopeType: "PROJECT" as const,
    scopeId: currentProjectId ?? "",
  };

  const userPermissions = useMemo(
    () =>
      getUserPermissionsAtScope({
        myBindings: myBindings.data,
        scopeType: primaryScope.scopeType,
        scopeId: primaryScope.scopeId,
        organizationId,
        orgProjects,
        isServiceKey: keyType === "service",
        getTeamRolePermissions: (role) => getTeamRolePermissions(role as TeamUserRole),
      }),
    [
      myBindings.data,
      primaryScope.scopeType,
      primaryScope.scopeId,
      organizationId,
      orgProjects,
      keyType,
    ],
  );

  const resetForm = () => {
    setName("");
    setDescription("");
    setExpirationPreset("");
    setCustomDate("");
    setSelectedScopes(
      currentProjectId
        ? [{ scopeType: "PROJECT", scopeId: currentProjectId }]
        : [],
    );
    setPermissionMode("all");
    setCategorySelections({});
    setKeyType("personal");
    setSelectedUserId(currentUserId);
  };

  useEffect(() => {
    if (isOpen) resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentUserId]);

  const handleCreate = () => {
    let expiresAt: Date | undefined;
    if (expirationPreset === "custom" && customDate) {
      expiresAt = new Date(customDate);
    } else if (expirationPreset && expirationPreset !== "custom") {
      const days = parseInt(expirationPreset, 10);
      expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    }

    const permissions =
      permissionMode === "restricted"
        ? computePermissionsFromSelections(categorySelections)
        : undefined;

    const isServiceKey = keyType === "service";

    const bindings = selectedScopes.map((s) => ({
      role: deriveBindingRole({
        permissionMode, scopeType: s.scopeType, scopeId: s.scopeId,
        myBindings: myBindings.data, organizationId, orgProjects, isServiceKey,
      }),
      scopeType: s.scopeType,
      scopeId: s.scopeId,
    }));

    const assignedToUserId =
      isAdmin && selectedUserId && selectedUserId !== currentUserId
        ? selectedUserId
        : undefined;

    onCreate({
      name,
      description,
      expiresAt,
      permissionMode,
      keyType,
      assignedToUserId,
      scopeType: primaryScope.scopeType,
      scopeId: primaryScope.scopeId,
      permissions,
      bindings,
    });
  };

  const hasAnySelection =
    permissionMode === "all" ||
    Object.values(categorySelections).some((v) => v !== "none");

  const canCreate = name.trim() && !isCreating && !myBindings.isLoading && hasAnySelection
    && (selectedScopes.length > 0 || !!currentProjectId);

  return (
    <Drawer.Root
      placement="end"
      size="lg"
      open={isOpen}
      onOpenChange={({ open }) => {
        if (!open) {
          onClose();
          resetForm();
        }
      }}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Heading size="md">Create new secret key</Heading>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <VStack gap={5} align="start">
            {/* Key type — only admins can create service keys */}
            {isAdmin && (
              <VStack gap={2} align="start" width="full">
                <Text fontWeight="600" fontSize="sm">
                  Key type
                </Text>
                <SegmentGroup.Root
                  size="sm"
                  value={keyType}
                  onValueChange={(e) =>
                    setKeyType(e.value as "personal" | "service")
                  }
                >
                  <SegmentGroup.Indicator />
                  <SegmentGroup.Item value="personal">
                    <SegmentGroup.ItemText>Personal</SegmentGroup.ItemText>
                    <SegmentGroup.ItemHiddenInput />
                  </SegmentGroup.Item>
                  <SegmentGroup.Item value="service">
                    <SegmentGroup.ItemText>Service</SegmentGroup.ItemText>
                    <SegmentGroup.ItemHiddenInput />
                  </SegmentGroup.Item>
                </SegmentGroup.Root>
                {keyType === "personal" && (
                  <VStack gap={2} align="start" width="full">
                    <Text fontSize="xs" color="fg.muted">
                      Tied to a user. If the user is removed from the
                      organization, this key will be disabled.
                    </Text>
                    <Select.Root
                      collection={memberCollection}
                      value={selectedUserId ? [selectedUserId] : []}
                      onValueChange={(details) => {
                        const val = details.value[0] ?? "";
                        setSelectedUserId(val);
                      }}
                    >
                      <Select.Trigger width="full" background="bg">
                        <Select.ValueText placeholder="Select user" />
                      </Select.Trigger>
                      <Select.Content>
                        {memberCollection.items.map((item) => (
                          <Select.Item key={item.value} item={item}>
                            {item.label}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select.Root>
                  </VStack>
                )}
                {keyType === "service" && (
                  <Text fontSize="xs" color="fg.muted">
                    Not tied to any user. Cannot be revoked when a user
                    leaves. Set permissions below.
                  </Text>
                )}
              </VStack>
            )}

            {/* Name */}
            <VStack gap={1} align="start" width="full">
              <Text fontWeight="600" fontSize="sm">
                Name
              </Text>
              <Input
                placeholder="e.g., CI Pipeline, Local Dev"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </VStack>

            {/* Description */}
            <VStack gap={1} align="start" width="full">
              <Text fontWeight="600" fontSize="sm">
                Description{" "}
                <Text as="span" color="fg.muted" fontWeight="400">
                  (optional)
                </Text>
              </Text>
              <Textarea
                placeholder="What is this key used for?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
                rows={3}
                resize="vertical"
              />
            </VStack>

            {/* Scope */}
            <VStack gap={1.5} align="start" width="full">
              <Text fontWeight="600" fontSize="sm">
                Scope
              </Text>
              <ScopeChipPicker
                value={selectedScopes}
                onChange={(next) => {
                  setSelectedScopes(next);
                  setCategorySelections({});
                }}
                organizationId={organizationId}
                organizationName={organizationName}
                availableTeams={orgTeams}
                availableProjects={orgProjects}
                label=""
                showQuickPicks
                currentOrganizationId={organizationId}
                currentTeamId={currentTeamId}
                currentProjectId={currentProjectId}
              />
            </VStack>

            {/* Permissions */}
            <VStack gap={2} align="start" width="full">
              <Text fontWeight="600" fontSize="sm">
                Permissions
              </Text>
              <HStack justify="space-between" width="full">
              <SegmentGroup.Root
                size="sm"
                value={permissionMode}
                onValueChange={(e) => {
                  const mode = e.value as "all" | "restricted";
                  setPermissionMode(mode);
                  if (mode === "all") setCategorySelections({});
                }}
              >
                <SegmentGroup.Indicator />
                <SegmentGroup.Item value="all">
                  <SegmentGroup.ItemText>All</SegmentGroup.ItemText>
                  <SegmentGroup.ItemHiddenInput />
                </SegmentGroup.Item>
                <SegmentGroup.Item value="restricted">
                  <SegmentGroup.ItemText>Restricted</SegmentGroup.ItemText>
                  <SegmentGroup.ItemHiddenInput />
                </SegmentGroup.Item>
              </SegmentGroup.Root>
              {permissionMode === "restricted" && (
                <PermissionCounter
                  count={Object.values(categorySelections).filter((v) => v && v !== "none").length}
                />
              )}
              </HStack>

              {permissionMode === "all" && (
                <Text fontSize="xs" color="fg.muted">
                  Full access within the selected scope, bounded by your role.
                </Text>
              )}

              {permissionMode === "restricted" && (
                <PermissionCategoryList
                  selections={categorySelections}
                  userPermissions={userPermissions}
                  onChange={setCategorySelections}
                />
              )}
            </VStack>

            {/* Expiration */}
            <VStack gap={1} align="start" width="full">
              <Text fontWeight="600" fontSize="sm">
                Expiration
              </Text>
              <Select.Root
                collection={expirationCollection}
                value={[expirationPreset]}
                onValueChange={(details) => {
                  const val = details.value[0] ?? "";
                  setExpirationPreset(val);
                  if (val !== "custom") setCustomDate("");
                }}
              >
                <Select.Trigger width="full" background="bg">
                  <Select.ValueText placeholder="No expiration" />
                </Select.Trigger>
                <Select.Content width="300px" paddingY={2}>
                  {EXPIRATION_OPTIONS.map((option) => (
                    <Select.Item key={option.value} item={option}>
                      {option.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
              {expirationPreset === "custom" && (
                <Input
                  type="date"
                  value={customDate}
                  min={minCustomDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                />
              )}
            </VStack>
          </VStack>
        </Drawer.Body>
        <Drawer.Footer>
          <HStack width="full" justify="end" gap={2}>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              colorPalette="blue"
              onClick={handleCreate}
              disabled={!canCreate}
            >
              Create secret key
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
