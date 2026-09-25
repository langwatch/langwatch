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
/**
 * "Edit API key": the same ceiling as create, on a key that already
 * exists. Selections are clamped TWICE — a stored or pre-existing level
 * can sit above what the caller now holds, else save fails `api_key_scope_violation`.
 */
import {
  computePermissionsFromSelections,
  PERMISSION_CATEGORIES,
  selectionsFromPermissions,
  type ApiKeyListEntry,
  type ApiKeyTrpcRoleBinding,
  type NamedApiKeyBinding,
} from "@langwatch/api-key-contract";
import type { WireOf } from "@langwatch/api/web";
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
} from "../../model/api-key-permissions.ts";
import {
  PermissionCategoryList,
  PermissionCounter,
  type PermissionSelection,
} from "../blocks/permission-category-list.tsx";
import { ScopeChipPicker, type ScopeTriadEntry } from "../elements/scope-picker.tsx";

/** A key as the browser holds one: the wire carries its instants as ISO strings. */
type ApiKeyRow = WireOf<ApiKeyListEntry>;
type MyBindings = {
  data: NamedApiKeyBinding[] | undefined;
  isLoading: boolean;
};
type OrgProject = { id: string; name: string; teamId: string };
type OrgTeam = { id: string; name: string };

type UpdateApiKeyInput = {
  apiKeyId: string;
  name?: string;
  description?: string | null;
  permissionMode?: PermissionMode;
  scopeType?: string;
  scopeId?: string;
  permissions?: string[];
  bindings?: ApiKeyTrpcRoleBinding[];
};

/** The most permissive selection a category's availability allows. */
function defaultPermissionSelection({
  canRead,
  canWrite,
}: {
  canRead: boolean;
  canWrite: boolean;
}): PermissionSelection {
  if (canWrite) return "write";
  if (canRead) return "read";
  return "none";
}

function highestSelections(userPermissions: string[]): Record<string, PermissionSelection> {
  const allSelected: Record<string, PermissionSelection> = {};
  for (const cat of PERMISSION_CATEGORIES) {
    const { canRead, canWrite } = categoryAccessAvailability({ category: cat, userPermissions });
    allSelected[cat.key] = defaultPermissionSelection({ canRead, canWrite });
  }
  return allSelected;
}

function updateKeyInput({
  apiKey,
  edits,
  selections,
  reader,
}: {
  apiKey: ApiKeyRow;
  edits: {
    name: string;
    description: string;
    permissionMode: PermissionMode;
    selectedScopes: ScopeTriadEntry[];
    primaryScope: { scopeType: string; scopeId: string };
  };
  selections: Record<string, PermissionSelection>;
  reader: {
    myBindings: MyBindings["data"];
    organizationId: string;
    orgProjects: OrgProject[];
    isServiceKey: boolean;
  };
}): UpdateApiKeyInput {
  const { permissionMode } = edits;
  return {
    apiKeyId: apiKey.id,
    name: edits.name !== apiKey.name ? edits.name : undefined,
    description:
      edits.description !== (apiKey.description ?? "") ? edits.description || null : undefined,
    permissionMode,
    scopeType: edits.primaryScope.scopeType,
    scopeId: edits.primaryScope.scopeId,
    permissions:
      permissionMode === "restricted" ? computePermissionsFromSelections(selections) : undefined,
    bindings: edits.selectedScopes.map((s) => ({
      role: deriveBindingRole({
        permissionMode,
        scopeType: s.scopeType,
        scopeId: s.scopeId,
        ...reader,
      }),
      scopeType: s.scopeType,
      scopeId: s.scopeId,
    })),
  };
}

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
  onSave: (input: UpdateApiKeyInput) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<ScopeTriadEntry[]>([]);
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

  // Same ceiling as the create drawer: team-role bags carry no org, gateway,
  // governance or playground permissions, so reading them directly would
  // lock rows a service/admin key can grant. Checked across every scope.
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
    const noCategorySelected = Object.values(effectiveCategorySelections).every(
      (v) => !v || v === "none",
    );
    const shouldPreselectAll = mode === "restricted" && noCategorySelected;
    if (shouldPreselectAll) setCategorySelections(highestSelections(userPermissions));
  };

  const handleSave = () => {
    if (!apiKey) return;

    onSave(
      updateKeyInput({
        apiKey,
        edits: { name, description, permissionMode, selectedScopes, primaryScope },
        selections: effectiveCategorySelections,
        reader: { myBindings: myBindings.data, organizationId, orgProjects, isServiceKey },
      }),
    );
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
