/**
 * "Create new secret key": decides what a key will be able to do. Every
 * level offered is bounded by what the caller holds at the selected
 * scope — the mint refuses (`api_key_scope_violation`) rather than dropping one.
 */

import { computePermissionsFromSelections } from "@langwatch/api-key-contract";
import type { ApiKeyRole } from "@langwatch/api-key-contract";
import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { Drawer } from "@langwatch/design-system/drawer";
import {
  Box,
  createListCollection,
  HStack,
  Input,
  Text,
  Textarea,
  VStack,
} from "@langwatch/design-system/primitives";
import { ScopeChipPicker, type ScopeTriadEntry } from "@langwatch/design-system/scope-chip-picker";
import { RawSegmentGroup as SegmentGroup } from "@langwatch/design-system/segmented-control";
import { Select } from "@langwatch/design-system/select";
import { SettingsField } from "@langwatch/design-system/settings-field";
import { TriangleAlert } from "lucide-react";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";

import { apiKeyApi } from "../../behavior/api-key-api.ts";
import {
  earliestCustomExpiration,
  EXPIRATION_NEVER,
  EXPIRATION_OPTIONS,
  EXPIRATION_UNCHOSEN,
  type CreateApiKeyInput,
  isExpirationChosen,
  resolveExpiresAt,
} from "../../model/api-key-form.ts";
import { useApiKeyHost } from "../../model/api-key-host.ts";
import {
  deriveBindingRole,
  getUserPermissionsAtScope,
  type PermissionMode,
} from "../../model/api-key-permissions.ts";
import {
  PermissionCategoryList,
  PermissionCounter,
  type PermissionSelection,
} from "../blocks/permission-category-list.tsx";

type MyBindings = {
  data: { scopeType: string; scopeId: string; role: ApiKeyRole }[] | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => unknown;
};

type OrgProject = { id: string; name: string; teamId: string };
type OrgTeam = { id: string; name: string };

type CreateKeyForm = {
  name: string;
  description: string;
  expirationPreset: string;
  customDate: string;
  permissionMode: PermissionMode;
  keyType: "personal" | "service";
};

type KeyReader = {
  myBindings: MyBindings["data"];
  organizationId: string;
  orgProjects: OrgProject[];
};

function assignedUserFor({
  isAdmin,
  selectedUserId,
  currentUserId,
}: {
  isAdmin: boolean;
  selectedUserId: string;
  currentUserId: string;
}): string | undefined {
  return isAdmin && selectedUserId && selectedUserId !== currentUserId ? selectedUserId : undefined;
}

function createKeyInput({
  form,
  categorySelections,
  selectedScopes,
  primaryScope,
  assignee,
  reader,
}: {
  form: CreateKeyForm;
  categorySelections: Record<string, PermissionSelection>;
  selectedScopes: ScopeTriadEntry[];
  primaryScope: { scopeType: string; scopeId: string };
  assignee: Parameters<typeof assignedUserFor>[0];
  reader: KeyReader;
}): CreateApiKeyInput {
  const { permissionMode, keyType } = form;
  const isServiceKey = keyType === "service";
  return {
    name: form.name,
    description: form.description,
    expiresAt: resolveExpiresAt({ preset: form.expirationPreset, customDate: form.customDate }),
    permissionMode,
    keyType,
    assignedToUserId: assignedUserFor(assignee),
    scopeType: primaryScope.scopeType,
    scopeId: primaryScope.scopeId,
    permissions:
      permissionMode === "restricted"
        ? computePermissionsFromSelections(categorySelections)
        : undefined,
    bindings: selectedScopes.map((s) => ({
      role: deriveBindingRole({
        permissionMode,
        scopeType: s.scopeType,
        scopeId: s.scopeId,
        ...reader,
        isServiceKey,
      }),
      scopeType: s.scopeType,
      scopeId: s.scopeId,
    })),
  };
}

const ACCESS_NOTE_ID = "api-key-access-note";

type KeyField = "name" | "scope" | "permissions" | "expiration";

/** The unmet requirements, in the order the form shows them. */
function missingFields(input: {
  name: string;
  expirationChosen: boolean;
  hasAnySelection: boolean;
  hasScope: boolean;
}): KeyField[] {
  const missing: KeyField[] = [];
  if (!input.name.trim()) missing.push("name");
  if (!input.hasScope) missing.push("scope");
  if (!input.hasAnySelection) missing.push("permissions");
  if (!input.expirationChosen) missing.push("expiration");
  return missing;
}

const FIELD_ERROR: Record<Exclude<KeyField, "expiration">, string> = {
  name: "Enter a name for this key.",
  scope: "Choose where this key can be used.",
  permissions: "Choose at least one permission, or switch to All.",
};

function focusKeyField({
  field,
  targets,
  fallback,
}: {
  field: KeyField;
  targets: Record<KeyField, RefObject<HTMLElement | null>>;
  fallback: RefObject<HTMLElement | null>;
}) {
  const target = targets[field].current ?? fallback.current;
  if (field === "name") target?.focus();
  else focusWithin(target);
}

function accessReason(myBindings: MyBindings): string {
  return myBindings.isError
    ? "Couldn't read your access. Retry above, then create the key."
    : "Reading your access. Create is available once it loads.";
}

function AccessNote({ myBindings }: { myBindings: MyBindings }) {
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    setRetrying(true);
    try {
      await myBindings.refetch();
    } finally {
      setRetrying(false);
    }
  };
  return (
    <Box id={ACCESS_NOTE_ID} width="full">
      {myBindings.isError ? (
        <Banner
          status="error"
          title="Couldn't read your access"
          icon={<TriangleAlert size={16} aria-hidden="true" />}
          action={
            <BannerAction
              onClick={() => void retry()}
              loading={retrying}
              data-testid="api-key-access-retry"
            >
              Retry
            </BannerAction>
          }
        >
          A key can only carry the access you hold, so none can be created until it loads. What you
          have entered is kept.
        </Banner>
      ) : (
        <Text as="output" textStyle="caption" color="fg.muted">
          Reading your access. Create is available once it loads.
        </Text>
      )}
    </Box>
  );
}

function focusWithin(element: HTMLElement | null) {
  element
    ?.querySelector<HTMLElement>(
      "button:not([disabled]), input:not([type='hidden']):not([disabled]), [tabindex]:not([tabindex='-1'])",
    )
    ?.focus();
}

function ExpirationHint({ chosen, attempted }: { chosen: boolean; attempted: boolean }) {
  if (chosen) return null;
  return (
    <Text
      textStyle="caption"
      color={attempted ? "fg.error" : "fg.muted"}
      data-testid="api-key-expiration-hint"
    >
      Choose when this key expires, or select No expiration.
    </Text>
  );
}

function KeyTypeField({
  keyType,
  onKeyTypeChange,
  selectedUserId,
  onUserChange,
  memberCollection,
}: {
  keyType: "personal" | "service";
  onKeyTypeChange: (next: "personal" | "service") => void;
  selectedUserId: string;
  onUserChange: (next: string) => void;
  memberCollection: ReturnType<typeof createListCollection<{ label: string; value: string }>>;
}) {
  return (
    <SettingsField label="Key type">
      <VStack gap={2} align="start" width="full">
        <SegmentGroup.Root
          size="sm"
          value={keyType}
          onValueChange={(e) => onKeyTypeChange(e.value as "personal" | "service")}
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
            <Text textStyle="caption" color="fg.muted">
              Tied to a user. If the user is removed from the organization, this key will be
              disabled.
            </Text>
            <Select.Root
              collection={memberCollection}
              value={selectedUserId ? [selectedUserId] : []}
              onValueChange={(details) => {
                const val = details.value[0] ?? "";
                onUserChange(val);
              }}
            >
              <Select.Trigger width="full">
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
          <Text textStyle="caption" color="fg.muted">
            Not tied to any user. Cannot be revoked when a user leaves. Set permissions below.
          </Text>
        )}
      </VStack>
    </SettingsField>
  );
}

function PermissionsField({
  error,
  permissionMode,
  onModeChange,
  selections,
  userPermissions,
  onSelectionsChange,
  containerRef,
  listRef,
}: {
  error: string | undefined;
  permissionMode: "all" | "restricted";
  onModeChange: (next: "all" | "restricted") => void;
  selections: Record<string, PermissionSelection>;
  userPermissions: string[];
  onSelectionsChange: (next: Record<string, PermissionSelection>) => void;
  containerRef: RefObject<HTMLDivElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <SettingsField label="Permissions" error={error}>
      <VStack ref={containerRef} gap={2} align="start" width="full">
        <HStack justify="space-between" width="full">
          <SegmentGroup.Root
            size="sm"
            value={permissionMode}
            onValueChange={(e) => onModeChange(e.value as "all" | "restricted")}
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
              count={Object.values(selections).filter((v) => v && v !== "none").length}
            />
          )}
        </HStack>

        {permissionMode === "all" && (
          <Text textStyle="caption" color="fg.muted">
            Full access within the selected scope, bounded by your role.
          </Text>
        )}

        {permissionMode === "restricted" && (
          <Box ref={listRef} width="full">
            <PermissionCategoryList
              selections={selections}
              userPermissions={userPermissions}
              onChange={onSelectionsChange}
            />
          </Box>
        )}
      </VStack>
    </SettingsField>
  );
}

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
  prefill,
  notice,
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
  /** The key the form opens filled with, such as a legacy key's replacement; no expiry. */
  prefill?: Pick<CreateApiKeyInput, "name" | "description" | "scopeId" | "keyType">;
  /** A warning over the form, such as that the key being replaced already stopped working. */
  notice?: { title: string; body: string };
  onClose: () => void;
  onCreate: (input: CreateApiKeyInput) => void;
}) {
  const host = useApiKeyHost();
  const currentUserId = host.currentUser()?.id ?? "";

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [expirationPreset, setExpirationPreset] = useState(EXPIRATION_UNCHOSEN);
  const [customDate, setCustomDate] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<ScopeTriadEntry[]>([]);
  const [permissionMode, setPermissionMode] = useState<"all" | "restricted">("all");
  const [categorySelections, setCategorySelections] = useState<Record<string, PermissionSelection>>(
    {},
  );
  const [keyType, setKeyType] = useState<"personal" | "service">("personal");
  const [selectedUserId, setSelectedUserId] = useState("");

  const orgMembers = apiKeyApi.apiKey.orgMembers.useQuery({ organizationId }, { enabled: isOpen });
  const isAdmin = (orgMembers.data?.length ?? 0) > 0;

  // Recomputed on every open rather than once, so a drawer opened just after
  // midnight cannot offer yesterday as the earliest custom expiry.
  const minCustomDate = useMemo(() => earliestCustomExpiration(), []);

  const expirationCollection = useMemo(
    () => createListCollection({ items: EXPIRATION_OPTIONS }),
    [],
  );

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

  const [attempted, setAttempted] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const scopeRef = useRef<HTMLDivElement>(null);
  const permissionsRef = useRef<HTMLDivElement>(null);
  const permissionListRef = useRef<HTMLDivElement>(null);
  const expirationRef = useRef<HTMLDivElement>(null);

  const resetForm = () => {
    setAttempted(false);
    setName(prefill?.name ?? "");
    setDescription(prefill?.description ?? "");
    setExpirationPreset(prefill ? EXPIRATION_NEVER : EXPIRATION_UNCHOSEN);
    setCustomDate("");
    const scopeId = prefill?.scopeId ?? currentProjectId;
    setSelectedScopes(scopeId ? [{ scopeType: "PROJECT", scopeId }] : []);
    setPermissionMode("all");
    setCategorySelections({});
    setKeyType(prefill?.keyType ?? "personal");
    setSelectedUserId(currentUserId);
  };

  useEffect(() => {
    if (isOpen) resetForm();
    // The form is reset when the drawer opens and when the reader changes, and
    // deliberately not when anything the reset writes changes — listing those
    // would re-run the reset over the reader's own edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentUserId]);

  const handleCreate = () => {
    if (isCreating) return;
    const [firstMissing] = missing;
    if (firstMissing) {
      setAttempted(true);
      focusKeyField({
        field: firstMissing,
        targets: {
          name: nameRef,
          scope: scopeRef,
          permissions: permissionListRef,
          expiration: expirationRef,
        },
        fallback: permissionsRef,
      });
      return;
    }
    onCreate(
      createKeyInput({
        form: { name, description, expirationPreset, customDate, permissionMode, keyType },
        categorySelections,
        selectedScopes,
        primaryScope,
        assignee: { isAdmin, selectedUserId, currentUserId },
        reader: { myBindings: myBindings.data, organizationId, orgProjects },
      }),
    );
  };

  const hasAnySelection =
    permissionMode === "all" || Object.values(categorySelections).some((v) => v !== "none");

  const expirationChosen = isExpirationChosen({ preset: expirationPreset, customDate });

  const missing = missingFields({
    name,
    expirationChosen,
    hasAnySelection,
    hasScope: selectedScopes.length > 0,
  });
  const showError = (field: Exclude<KeyField, "expiration">) =>
    attempted && missing.includes(field) ? FIELD_ERROR[field] : undefined;
  const accessBlocked = myBindings.isLoading || myBindings.isError;

  return (
    <Drawer
      size="lg"
      open={isOpen}
      onClose={() => {
        onClose();
        resetForm();
      }}
      title="Create new secret key"
      footer={{
        cancel: { onClick: onClose },
        busy: isCreating,
        primaryAction: {
          label: "Create secret key",
          onClick: handleCreate,
          loading: isCreating,
          disabledReason: accessBlocked ? accessReason(myBindings) : void 0,
          "data-testid": "api-key-create-submit",
        },
      }}
    >
      <VStack gap={5} align="start">
        {accessBlocked && <AccessNote myBindings={myBindings} />}
        {notice && (
          <Banner
            status="warning"
            title={notice.title}
            icon={<TriangleAlert size={16} aria-hidden="true" />}
          >
            {notice.body}
          </Banner>
        )}
        {/* Key type — only admins can create service keys */}
        {isAdmin && (
          <KeyTypeField
            keyType={keyType}
            onKeyTypeChange={setKeyType}
            selectedUserId={selectedUserId}
            onUserChange={setSelectedUserId}
            memberCollection={memberCollection}
          />
        )}

        {/* Name */}
        <SettingsField label="Name" error={showError("name")}>
          <Input
            ref={nameRef}
            placeholder="e.g., CI Pipeline, Local Dev"
            data-testid="api-key-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </SettingsField>

        {/* Description */}
        <SettingsField label="Description (optional)">
          <Textarea
            placeholder="What is this key used for?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            rows={3}
            resize="vertical"
          />
        </SettingsField>

        {/* Scope */}
        <SettingsField label="Scope" error={showError("scope")}>
          <Box ref={scopeRef} width="full">
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
          </Box>
        </SettingsField>

        {/* Permissions */}
        <PermissionsField
          error={showError("permissions")}
          permissionMode={permissionMode}
          onModeChange={(mode) => {
            setPermissionMode(mode);
            if (mode === "all") setCategorySelections({});
          }}
          selections={categorySelections}
          userPermissions={userPermissions}
          onSelectionsChange={setCategorySelections}
          containerRef={permissionsRef}
          listRef={permissionListRef}
        />

        {/* Expiration */}
        <SettingsField label="Expiration">
          <VStack ref={expirationRef} gap={1} align="start" width="full">
            <Select.Root
              collection={expirationCollection}
              value={[expirationPreset]}
              onValueChange={(details) => {
                const val = details.value[0] ?? EXPIRATION_UNCHOSEN;
                setExpirationPreset(val);
                if (val !== "custom") setCustomDate("");
              }}
            >
              <Select.Trigger width="full">
                <Select.ValueText placeholder="Choose when this key expires" />
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
            <ExpirationHint chosen={expirationChosen} attempted={attempted} />
          </VStack>
        </SettingsField>
      </VStack>
    </Drawer>
  );
}
