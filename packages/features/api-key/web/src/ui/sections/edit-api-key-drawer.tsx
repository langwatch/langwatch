/**
 * "Edit API key": the same ceiling, applied to a key that already exists.
 *
 * Moved from `platform/app/src/pages/settings/api-keys/EditApiKeyDrawer.tsx`,
 * mounted inline by the screen exactly as the create drawer is. The
 * substitutions are the create drawer's, for the same reasons, and the one
 * behaviour worth restating here is why the selections are clamped TWICE:
 * a level stored on the key, or picked before another scope was added, can sit
 * above what the caller holds everywhere the key will now be bound, and the save
 * would come back `api_key_scope_violation` for a row that still looked granted.
 */

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
import {
  computePermissionsFromSelections,
  PERMISSION_CATEGORIES,
  selectionsFromPermissions,
  type ApiKeyListEntry,
  type NamedApiKeyBinding,
} from "@langwatch/api-key-contract";
import { ScopeChipPicker, type ScopeChipPickerEntry } from "../elements/scope-picker";
import { Drawer } from "@langwatch/design-system/drawer";
import { useEffect, useMemo, useState } from "react";
import {
  bindingsToPermissionMode,
  bindingsToScopes,
  bindingsToSelections,
  categoryAccessAvailability,
  clampSelectionsToAvailability,
  deriveBindingRole,
  getUserPermissionsAcrossScopes,
  teamRolePermissions,
  type PermissionMode,
} from "../../model/api-key-permissions";
import {
  PermissionCategoryList,
  PermissionCounter,
  type PermissionSelection,
} from "../blocks/permission-category-list";

type ApiKeyRow = ApiKeyListEntry;
type MyBindings = {
  data: NamedApiKeyBinding[] | undefined;
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
  const [selectedScopes, setSelectedScopes] = useState<ScopeChipPickerEntry[]>([]);
  const [permissionMode, setPermissionMode] = useState<"all" | "restricted">("all");
  const [categorySelections, setCategorySelections] = useState<Record<string, PermissionSelection>>(
    {},
  );

  const isServiceKey = apiKey ? !apiKey.userId : false;

  const ceilingScopes = useMemo(
    () =>
      selectedScopes.length > 0
        ? selectedScopes
        : [
            {
              scopeType: "PROJECT" as const,
              scopeId: currentProjectId ?? "",
            },
          ],
    [selectedScopes, currentProjectId],
  );
  const primaryScope = ceilingScopes[0]!;

  // Same ceiling the create drawer shows: the team-role bags carry no
  // organization, gateway, governance or playground permissions, so reading
  // them directly would lock rows a service key or an organization admin can
  // in fact grant. Across every selected scope, not only the first: one
  // permission list serves every binding, so a row the second scope refuses
  // would fail the save with a scope violation.
  const userPermissions = useMemo(() => {
    return getUserPermissionsAcrossScopes({
      myBindings: myBindings.data,
      scopes: ceilingScopes,
      organizationId,
      orgProjects,
      isServiceKey,
    });
  }, [myBindings.data, ceilingScopes, organizationId, orgProjects, isServiceKey]);

  useEffect(() => {
    if (apiKey) {
      setName(apiKey.name);
      setDescription(apiKey.description ?? "");

      const mode = bindingsToPermissionMode(apiKey);
      setPermissionMode(mode);

      setSelectedScopes(bindingsToScopes(apiKey.roleBindings));

      if (mode === "restricted") {
        setCategorySelections(
          bindingsToSelections(apiKey, {
            permissionCategories: PERMISSION_CATEGORIES,
            selectionsFromPermissions,
            getTeamRolePermissions: teamRolePermissions,
          }) as Record<string, PermissionSelection>,
        );
      } else {
        setCategorySelections({});
      }
    }
  }, [apiKey, organizationId, currentTeamId, currentProjectId]);

  // Re-narrowed to the ceiling of whatever is selected NOW: the key's stored
  // level, or one picked before another scope was added, can sit above what
  // the caller holds everywhere the key will be bound, and the save would
  // come back `api_key_scope_violation` for a row that still looked granted.
  const effectiveCategorySelections = useMemo(
    () =>
      clampSelectionsToAvailability({
        selections: categorySelections,
        userPermissions,
      }) as Record<string, PermissionSelection>,
    [categorySelections, userPermissions],
  );

  const handlePermissionModeChange = (mode: "all" | "restricted") => {
    setPermissionMode(mode);
    if (
      mode === "restricted" &&
      Object.values(effectiveCategorySelections).every((v) => !v || v === "none")
    ) {
      const allSelected: Record<string, PermissionSelection> = {};
      for (const cat of PERMISSION_CATEGORIES) {
        const { canRead, canWrite } = categoryAccessAvailability({
          category: cat,
          userPermissions,
        });
        allSelected[cat.key] = canWrite ? "write" : canRead ? "read" : "none";
      }
      setCategorySelections(allSelected);
    }
  };

  const handleSave = () => {
    if (!apiKey) return;

    const permissions =
      permissionMode === "restricted"
        ? computePermissionsFromSelections(effectiveCategorySelections)
        : undefined;

    const bindings = selectedScopes.map((s) => ({
      role: deriveBindingRole({
        permissionMode,
        scopeType: s.scopeType,
        scopeId: s.scopeId,
        myBindings: myBindings.data,
        organizationId,
        orgProjects,
        isServiceKey,
      }),
      scopeType: s.scopeType,
      scopeId: s.scopeId,
    }));

    onSave({
      apiKeyId: apiKey.id,
      name: name !== apiKey.name ? name : undefined,
      description: description !== (apiKey.description ?? "") ? description || null : undefined,
      permissionMode,
      scopeType: primaryScope.scopeType,
      scopeId: primaryScope.scopeId,
      permissions,
      bindings,
    });
  };

  const hasAnySelection =
    permissionMode === "all" || Object.values(categorySelections).some((v) => v !== "none");

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
              <Input value={name} onChange={(e) => setName(e.target.value)} />
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
                  onValueChange={(e) => handlePermissionModeChange(e.value as "all" | "restricted")}
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
                    count={
                      Object.values(effectiveCategorySelections).filter((v) => v && v !== "none")
                        .length
                    }
                  />
                )}
              </HStack>

              {permissionMode === "restricted" && (
                <PermissionCategoryList
                  selections={effectiveCategorySelections}
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
            <Button colorPalette="blue" onClick={handleSave} disabled={!canSave}>
              Save
            </Button>
          </HStack>
        </Drawer.Footer>
      </Drawer.Content>
    </Drawer.Root>
  );
}
