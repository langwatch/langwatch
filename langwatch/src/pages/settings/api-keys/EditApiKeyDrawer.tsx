import {
  Button,
  Heading,
  HStack,
  Input,
  SegmentGroup,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import { Drawer } from "../../../components/ui/drawer";
import {
  ScopeChipPicker,
  type ScopeChipPickerEntry,
} from "../../../components/settings/ScopeChipPicker";
import type { RouterOutputs } from "../../../utils/api";
import {
  PERMISSION_CATEGORIES,
  computePermissionsFromSelections,
  selectionsFromPermissions,
} from "../../../server/api-key/permission-categories";
import {
  getTeamRolePermissions,
  hasPermissionWithHierarchy,
} from "../../../server/api/rbac";
import { TeamUserRole } from "@prisma/client";
import {
  PermissionCategoryList,
  PermissionCounter,
  type PermissionSelection,
} from "./PermissionCategoryList";
import {
  bindingsToPermissionMode,
  bindingsToScopes,
  bindingsToSelections,
  deriveBindingRole,
  findBindingAtScope,
  type PermissionMode,
} from "./utils";

type ApiKeyRow = RouterOutputs["apiKey"]["list"][number];
type MyBindingsData = RouterOutputs["apiKey"]["myBindings"];
type MyBindings = {
  data: MyBindingsData | undefined;
  isLoading: boolean;
};
type OrgProject = { id: string; name: string; teamId: string };
type OrgTeam = { id: string; name: string };

export function EditApiKeyDrawer({
  apiKey,
  isUpdating,
  myBindings,
  orgProjects,
  orgTeams,
  organizationId,
  organizationName,
  currentTeamId,
  currentProjectId,
  onClose,
  onSave,
}: {
  apiKey: ApiKeyRow | null;
  isUpdating: boolean;
  myBindings: MyBindings;
  orgProjects: OrgProject[];
  orgTeams: OrgTeam[];
  organizationId: string;
  organizationName: string | undefined;
  currentTeamId?: string;
  currentProjectId?: string;
  onClose: () => void;
  onSave: (input: {
    apiKeyId: string;
    name?: string;
    description?: string | null;
    permissionMode?: PermissionMode;
    scopeType?: string;
    scopeId?: string;
    permissions?: string[];
    bindings?: Array<{
      role: string;
      scopeType: string;
      scopeId: string;
    }>;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<ScopeChipPickerEntry[]>(
    [],
  );
  const [permissionMode, setPermissionMode] = useState<"all" | "restricted">(
    "all",
  );
  const [categorySelections, setCategorySelections] = useState<
    Record<string, PermissionSelection>
  >({});

  const isServiceKey = apiKey ? !apiKey.userId : false;

  const primaryScope = selectedScopes[0] ?? {
    scopeType: "PROJECT" as const,
    scopeId: currentProjectId ?? "",
  };

  const userPermissions = useMemo(() => {
    if (isServiceKey) return getTeamRolePermissions(TeamUserRole.ADMIN);
    if (!myBindings.data) return [];

    const binding = findBindingAtScope({
      bindings: myBindings.data,
      scopeType: primaryScope.scopeType,
      scopeId: primaryScope.scopeId,
      organizationId,
      orgProjects,
    });

    if (!binding) return [];
    return getTeamRolePermissions(binding.role as TeamUserRole);
  }, [
    myBindings.data,
    primaryScope.scopeType,
    primaryScope.scopeId,
    organizationId,
    orgProjects,
    isServiceKey,
  ]);

  useEffect(() => {
    if (apiKey) {
      setName(apiKey.name);
      setDescription(apiKey.description ?? "");

      const mode = bindingsToPermissionMode(apiKey);
      setPermissionMode(mode);

      setSelectedScopes(bindingsToScopes(apiKey.roleBindings));

      if (mode === "restricted") {
        setCategorySelections(bindingsToSelections(apiKey, {
          permissionCategories: PERMISSION_CATEGORIES,
          selectionsFromPermissions,
          getTeamRolePermissions: (role) => getTeamRolePermissions(role as TeamUserRole),
        }) as Record<string, PermissionSelection>);
      } else {
        setCategorySelections({});
      }
    }
  }, [apiKey, organizationId, currentTeamId, currentProjectId]);

  const handlePermissionModeChange = (mode: "all" | "restricted") => {
    setPermissionMode(mode);
    if (mode === "restricted" && Object.values(categorySelections).every((v) => !v || v === "none")) {
      const allSelected: Record<string, PermissionSelection> = {};
      for (const cat of PERMISSION_CATEGORIES) {
        const canRead = cat.readPermissions.every((p) =>
          hasPermissionWithHierarchy(userPermissions, p),
        );
        const canWrite =
          cat.accessLevels.includes("write") &&
          cat.writePermissions.every((p) =>
            hasPermissionWithHierarchy(userPermissions, p),
          );
        allSelected[cat.key] = canWrite ? "write" : canRead ? "read" : "none";
      }
      setCategorySelections(allSelected);
    }
  };

  const handleSave = () => {
    if (!apiKey) return;

    const permissions =
      permissionMode === "restricted"
        ? computePermissionsFromSelections(categorySelections)
        : undefined;

    const bindings = selectedScopes.map((s) => ({
      role: deriveBindingRole({
        permissionMode, scopeType: s.scopeType, scopeId: s.scopeId,
        myBindings: myBindings.data, organizationId, orgProjects, isServiceKey,
      }),
      scopeType: s.scopeType,
      scopeId: s.scopeId,
    }));

    onSave({
      apiKeyId: apiKey.id,
      name: name !== apiKey.name ? name : undefined,
      description:
        description !== (apiKey.description ?? "")
          ? description || null
          : undefined,
      permissionMode,
      scopeType: primaryScope.scopeType,
      scopeId: primaryScope.scopeId,
      permissions,
      bindings,
    });
  };

  const hasAnySelection =
    permissionMode === "all" ||
    Object.values(categorySelections).some((v) => v !== "none");

  const canSave = name.trim() && !isUpdating && hasAnySelection;

  return (
    <Drawer.Root
      placement="end"
      size="lg"
      open={!!apiKey}
      onOpenChange={({ open }) => {
        if (!open) onClose();
      }}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Heading size="md">Edit API key</Heading>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <VStack gap={5} align="start">
            {/* Name */}
            <VStack gap={1} align="start" width="full">
              <Text fontWeight="600" fontSize="sm">
                Name
              </Text>
              <Input
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
                onValueChange={(e) =>
                  handlePermissionModeChange(e.value as "all" | "restricted")
                }
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

              {permissionMode === "restricted" && (
                <PermissionCategoryList
                  selections={categorySelections}
                  userPermissions={userPermissions}
                  onChange={setCategorySelections}
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
              onClick={handleSave}
              disabled={!canSave}
            >
              Save
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
