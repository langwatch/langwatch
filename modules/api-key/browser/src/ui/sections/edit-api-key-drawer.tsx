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
  type ApiKeyTrpcGrant,
  type NamedApiKeyBinding,
} from "@langwatch/api-key-contract";
import type { WireOf } from "@langwatch/api/web";
import { Drawer } from "@langwatch/design-system/drawer";
import { HStack, Input, Textarea, VStack } from "@langwatch/design-system/primitives";
import { ScopeChipPicker, type ScopeTriadEntry } from "@langwatch/design-system/scope-chip-picker";
import { RawSegmentGroup as SegmentGroup } from "@langwatch/design-system/segmented-control";
import { SettingsField } from "@langwatch/design-system/settings-field";
import { TriangleAlert } from "lucide-react";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";

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
import { StatusCard } from "../blocks/status-card.tsx";

/** A key as the browser holds one: the wire carries its instants as ISO strings. */
type ApiKeyRow = WireOf<ApiKeyListEntry>;
type MyBindings = {
  data: NamedApiKeyBinding[] | undefined;
  isLoading: boolean;
  isError: boolean;
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
  bindings?: ApiKeyTrpcGrant[];
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

const ACCESS_UNREADABLE = "Your access couldn't be read. Close this drawer and try again.";

function storedSelections({
  apiKey,
  mode,
}: {
  apiKey: ApiKeyRow;
  mode: PermissionMode;
}): Record<string, PermissionSelection> {
  if (mode !== "restricted") return {};
  return bindingsToSelections(apiKey, {
    permissionCategories: PERMISSION_CATEGORIES,
    selectionsFromPermissions,
    getTeamRolePermissions: teamRolePermissions,
  }) as Record<string, PermissionSelection>;
}

function focusFirstInvalid({
  nameMissing,
  name,
  permissions,
}: {
  nameMissing: boolean;
  name: RefObject<HTMLInputElement | null>;
  permissions: RefObject<HTMLElement | null>;
}) {
  const target = nameMissing
    ? name.current
    : permissions.current?.querySelector<HTMLElement>(
        "button:not([disabled]), input:not([disabled])",
      );
  target?.focus();
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

  const [attempted, setAttempted] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const permissionsRef = useRef<HTMLDivElement>(null);

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
      setAttempted(false);
      setName(apiKey.name);
      setDescription(apiKey.description ?? "");

      const mode = bindingsToPermissionMode(apiKey);
      setPermissionMode(mode);

      setSelectedScopes(bindingsToScopes(apiKey.grants));

      setCategorySelections(storedSelections({ apiKey, mode }));
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

  const hasAnySelection =
    permissionMode === "all" || Object.values(categorySelections).some((v) => v !== "none");
  const nameMissing = !name.trim();
  const permissionsMissing = !hasAnySelection;

  const handleSave = () => {
    if (!apiKey || isUpdating) return;
    if (nameMissing || permissionsMissing) {
      setAttempted(true);
      focusFirstInvalid({ nameMissing, name: nameRef, permissions: permissionsRef });
      return;
    }

    onSave(
      updateKeyInput({
        apiKey,
        edits: { name, description, permissionMode, selectedScopes, primaryScope },
        selections: effectiveCategorySelections,
        reader: { myBindings: myBindings.data, organizationId, orgProjects, isServiceKey },
      }),
    );
  };

  return (
    <Drawer
      size="lg"
      open={!!apiKey}
      onClose={onClose}
      title="Edit API key"
      footer={{
        cancel: { onClick: onClose },
        busy: isUpdating,
        primaryAction: {
          label: "Save",
          onClick: handleSave,
          loading: isUpdating,
          disabledReason: myBindings.isError ? ACCESS_UNREADABLE : void 0,
        },
      }}
    >
      <VStack gap={5} align="start">
        {myBindings.isError && (
          <StatusCard palette="red" icon={TriangleAlert} title="Couldn't read your access">
            A key can only carry the access you hold, so it can't be saved until it loads. Close
            this drawer and try again.
          </StatusCard>
        )}
        {/* Name */}
        <SettingsField
          label="Name"
          error={attempted && nameMissing ? "Enter a name for this key." : undefined}
        >
          <Input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} />
        </SettingsField>

        {/* Description */}
        <SettingsField label="Description (optional)">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            rows={3}
            resize="vertical"
          />
        </SettingsField>

        {/* Scope */}
        <SettingsField label="Scope">
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
        </SettingsField>

        {/* Permissions */}
        <SettingsField
          label="Permissions"
          error={
            attempted && permissionsMissing
              ? "Choose at least one permission, or switch to All."
              : undefined
          }
        >
          <VStack ref={permissionsRef} gap={2} align="start" width="full">
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
        </SettingsField>
      </VStack>
    </Drawer>
  );
}
