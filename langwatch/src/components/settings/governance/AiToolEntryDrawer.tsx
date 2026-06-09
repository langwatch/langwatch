import {
  Alert,
  Box,
  Button,
  HStack,
  Heading,
  Image,
  Input,
  NativeSelect,
  Spacer,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { Bot, Wrench } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  ASSISTANT_OPTIONS,
  ASSISTANT_PRESETS,
  type AssistantKind,
} from "~/components/me/tiles/assistantIcons";
import {
  TOOL_KINDS,
  TOOL_PRESETS,
  isToolPresetAsset,
  toolPresetAsset,
} from "~/components/me/tiles/toolIcons";
import {
  ScopeChipPicker,
  type ScopeChipPickerEntry,
} from "~/components/settings/ScopeChipPicker";
import { Drawer } from "~/components/ui/drawer";
import { Link } from "~/components/ui/link";
import { Switch } from "~/components/ui/switch";
import { toaster } from "~/components/ui/toaster";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

import type {
  AiToolEntry,
  AiToolTileType,
} from "~/components/me/tiles/types";

const TILE_TYPE_OPTIONS: Array<{ value: AiToolTileType; label: string }> = [
  { value: "coding_assistant", label: "Coding assistant" },
  { value: "model_provider", label: "Model provider" },
  { value: "external_tool", label: "Internal tool" },
];

const PRESET_PREFIX = "preset:";
const DATA_URL_PREFIX = "data:";
const MAX_ICON_BASE64_BYTES = 256 * 1024; // matches server-side iconAssetSchema cap

const ASSISTANT_KIND_VALUES = new Set<AssistantKind>([
  "claude_code",
  "codex",
  "gemini",
  "opencode",
  "cursor",
  "custom",
]);

function isAssistantKind(value: string): value is AssistantKind {
  return ASSISTANT_KIND_VALUES.has(value as AssistantKind);
}

interface CodingAssistantForm {
  type: "coding_assistant";
  displayName: string;
  assistantKind: AssistantKind;
  setupCommand: string;
  helperText: string;
  setupDocsUrl: string;
  /// CLI path policy folded into the tile (replaces PlatformToolPolicy).
  /// Default true. Cursor forces allowOtelDirect=false (GUI-only).
  allowVk: boolean;
  allowOtelDirect: boolean;
  /// Direct-OTLP usage is part of a bundled subscription (not billed per
  /// token). Default true. Gateway usage ignores this and is always billed.
  bundledPlan: boolean;
}

interface ModelProviderForm {
  type: "model_provider";
  displayName: string;
  providerKey: string;
  defaultLabel: string;
  suggestedRoutingPolicyId: string;
  projectSuggestionText: string;
}

interface ExternalToolForm {
  type: "external_tool";
  displayName: string;
  descriptionMarkdown: string;
  linkUrl: string;
  ctaLabel: string;
}

type FormState = CodingAssistantForm | ModelProviderForm | ExternalToolForm;

function blankForm(type: AiToolTileType): FormState {
  if (type === "coding_assistant") {
    return {
      type,
      displayName: "",
      assistantKind: "claude_code",
      setupCommand: "",
      helperText: "",
      setupDocsUrl: "",
      allowVk: true,
      allowOtelDirect: true,
      bundledPlan: true,
    };
  }
  if (type === "model_provider") {
    return {
      type,
      displayName: "",
      providerKey: "",
      defaultLabel: "",
      suggestedRoutingPolicyId: "",
      projectSuggestionText: "",
    };
  }
  return {
    type,
    displayName: "",
    descriptionMarkdown: "",
    linkUrl: "",
    ctaLabel: "",
  };
}

function formFromEntry(entry: AiToolEntry): FormState {
  const cfg = entry.config as unknown as Record<string, unknown>;
  const baseStr = (key: string): string => {
    const v = cfg[key];
    return typeof v === "string" ? v : "";
  };
  if (entry.type === "coding_assistant") {
    const rawKind = typeof cfg.assistantKind === "string" ? cfg.assistantKind : "";
    const kind = isAssistantKind(rawKind) ? rawKind : "custom";
    const boolOr = (key: string, fallback: boolean): boolean =>
      typeof cfg[key] === "boolean" ? (cfg[key] as boolean) : fallback;
    return {
      type: "coding_assistant",
      displayName: entry.displayName,
      assistantKind: kind,
      setupCommand: baseStr("setupCommand"),
      helperText: baseStr("helperText"),
      setupDocsUrl: baseStr("setupDocsUrl"),
      allowVk: boolOr("allowVk", true),
      // Cursor is GUI-only - direct OTLP never applies, regardless of a
      // stored value. Force it off so the toggle reads honestly.
      allowOtelDirect: kind === "cursor" ? false : boolOr("allowOtelDirect", true),
      bundledPlan: boolOr("bundledPlan", true),
    };
  }
  if (entry.type === "model_provider") {
    return {
      type: "model_provider",
      displayName: entry.displayName,
      providerKey: baseStr("providerKey"),
      defaultLabel: baseStr("defaultLabel"),
      suggestedRoutingPolicyId: baseStr("suggestedRoutingPolicyId"),
      projectSuggestionText: baseStr("projectSuggestionText"),
    };
  }
  return {
    type: "external_tool",
    displayName: entry.displayName,
    descriptionMarkdown: baseStr("descriptionMarkdown"),
    linkUrl: baseStr("linkUrl"),
    ctaLabel: baseStr("ctaLabel"),
  };
}

function configFromForm(form: FormState): Record<string, unknown> {
  if (form.type === "coding_assistant") {
    return {
      assistantKind: form.assistantKind,
      setupCommand: form.setupCommand.trim(),
      ...(form.helperText.trim() ? { helperText: form.helperText.trim() } : {}),
      ...(form.setupDocsUrl.trim()
        ? { setupDocsUrl: form.setupDocsUrl.trim() }
        : {}),
      // CLI path policy folded into the tile. Cursor is GUI-only, so its
      // OTLP-direct path is always false regardless of the toggle state.
      allowVk: form.allowVk,
      allowOtelDirect:
        form.assistantKind === "cursor" ? false : form.allowOtelDirect,
      bundledPlan: form.bundledPlan,
    };
  }
  if (form.type === "model_provider") {
    return {
      providerKey: form.providerKey.trim(),
      ...(form.defaultLabel.trim()
        ? { defaultLabel: form.defaultLabel.trim() }
        : {}),
      ...(form.suggestedRoutingPolicyId.trim()
        ? { suggestedRoutingPolicyId: form.suggestedRoutingPolicyId.trim() }
        : {}),
      ...(form.projectSuggestionText.trim()
        ? { projectSuggestionText: form.projectSuggestionText.trim() }
        : {}),
    };
  }
  return {
    descriptionMarkdown: form.descriptionMarkdown.trim(),
    linkUrl: form.linkUrl.trim(),
    ...(form.ctaLabel.trim() ? { ctaLabel: form.ctaLabel.trim() } : {}),
  };
}

function deriveDefaultIconAsset(form: FormState): string | null {
  if (form.type === "coding_assistant" && form.assistantKind !== "custom") {
    return `preset:${form.assistantKind}`;
  }
  if (form.type === "external_tool") {
    return toolPresetAsset("wrench");
  }
  return null;
}

interface Props {
  organizationId: string;
  state:
    | { mode: "create"; type: AiToolTileType }
    | { mode: "edit"; entry: AiToolEntry }
    | null;
  onClose: () => void;
}

/** Map a tile's department bindings into ScopeChipPicker entries. Empty
 *  bindings = org-wide → a single ORGANIZATION entry. */
function scopesFromEntry(
  entry: AiToolEntry,
  organizationId: string,
): ScopeChipPickerEntry[] {
  const departmentIds = entry.departmentIds ?? [];
  if (departmentIds.length === 0) {
    return [{ scopeType: "ORGANIZATION", scopeId: organizationId }];
  }
  return departmentIds.map((id) => ({
    scopeType: "DEPARTMENT" as const,
    scopeId: id,
  }));
}

export function AiToolEntryDrawer({ organizationId, state, onClose }: Props) {
  const utils = api.useUtils();
  const { organization } = useOrganizationTeamProject();

  const departmentsQuery = api.departments.list.useQuery(
    { organizationId },
    { enabled: !!state, refetchOnWindowFocus: false },
  );
  const departments = departmentsQuery.data ?? [];

  const [form, setForm] = useState<FormState>(() =>
    state?.mode === "edit"
      ? formFromEntry(state.entry)
      : blankForm(state?.type ?? "coding_assistant"),
  );
  // Visibility scopes: a single ORGANIZATION entry = org-wide, or one or
  // more DEPARTMENT entries. New tiles default to org-wide.
  const [scopes, setScopes] = useState<ScopeChipPickerEntry[]>(() =>
    state?.mode === "edit"
      ? scopesFromEntry(state.entry, organizationId)
      : [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
  );
  const [iconAsset, setIconAsset] = useState<string | null>(
    state?.mode === "edit"
      ? state.entry.iconAsset ?? null
      : deriveDefaultIconAsset(blankForm(state?.type ?? "coding_assistant")),
  );

  // Reset state when drawer opens for a different entry/type
  useEffect(() => {
    if (!state) return;
    const nextForm =
      state.mode === "edit" ? formFromEntry(state.entry) : blankForm(state.type);
    setForm(nextForm);
    setScopes(
      state.mode === "edit"
        ? scopesFromEntry(state.entry, organizationId)
        : [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
    );
    setIconAsset(
      state.mode === "edit"
        ? state.entry.iconAsset ?? null
        : deriveDefaultIconAsset(nextForm),
    );
  }, [state, organizationId]);

  const isEdit = state?.mode === "edit";

  // Derive the department-id set from the scope picker. An ORGANIZATION
  // entry means org-wide (empty department set); DEPARTMENT entries map
  // back to ids. ORGANIZATION and DEPARTMENT are mutually exclusive in the
  // picker (collapseRedundantScopes enforces it), so this is unambiguous.
  const departmentIds = useMemo(
    () =>
      scopes
        .filter((s) => s.scopeType === "DEPARTMENT")
        .map((s) => s.scopeId),
    [scopes],
  );

  // When the user changes the assistantKind picker on a coding_assistant
  // tile, auto-update iconAsset to the corresponding preset (unless they
  // already have a custom upload they don't want to lose).
  const onAssistantKindChange = (kind: AssistantKind) => {
    if (form.type !== "coding_assistant") return;
    setForm({
      ...form,
      assistantKind: kind,
      // Cursor is GUI-only - direct OTLP never applies, so force the
      // toggle off when the admin picks it.
      ...(kind === "cursor" ? { allowOtelDirect: false } : {}),
    });
    if (kind !== "custom") {
      setIconAsset(`preset:${kind}`);
    } else if (
      iconAsset?.startsWith(PRESET_PREFIX) ||
      iconAsset === null
    ) {
      // Switching from preset → custom clears the preset until they upload
      setIconAsset(null);
    }
  };

  const providerOptionsQuery = api.aiTools.providerOptions.useQuery(
    { organizationId },
    {
      enabled: !!state && form.type === "model_provider",
    },
  );

  const routingPolicyOptionsQuery = api.aiTools.routingPolicyOptions.useQuery(
    { organizationId },
    {
      enabled: !!state && form.type === "model_provider",
    },
  );

  const onSuccess = () => {
    void utils.aiTools.adminList.invalidate({ organizationId });
    void utils.aiTools.list.invalidate({ organizationId });
    toaster.create({
      title: isEdit ? "Tile updated" : "Tile published",
      type: "success",
    });
    onClose();
  };

  const onError = (err: { message: string }) => {
    toaster.create({
      title: isEdit ? "Failed to update tile" : "Failed to publish tile",
      description: err.message,
      type: "error",
    });
  };

  const createMutation = api.aiTools.create.useMutation({ onSuccess, onError });
  const updateMutation = api.aiTools.update.useMutation({ onSuccess, onError });

  const isPending = createMutation.isPending || updateMutation.isPending;

  const canSave = useMemo(() => {
    if (!form.displayName.trim()) return false;
    if (form.type === "coding_assistant") {
      if (!form.setupCommand.trim()) return false;
      if (form.assistantKind === "custom" && !iconAsset) return false;
    }
    if (form.type === "model_provider" && !form.providerKey.trim()) {
      return false;
    }
    if (
      form.type === "external_tool" &&
      (!form.descriptionMarkdown.trim() || !form.linkUrl.trim())
    ) {
      return false;
    }
    return true;
  }, [form, iconAsset]);

  const onSave = () => {
    if (!canSave || !state) return;
    const config = configFromForm(form);
    if (state.mode === "create") {
      createMutation.mutate({
        organizationId,
        departmentIds,
        type: form.type,
        displayName: form.displayName.trim(),
        iconAsset,
        config,
      });
    } else {
      updateMutation.mutate({
        organizationId,
        id: state.entry.id,
        type: form.type,
        displayName: form.displayName.trim(),
        iconAsset,
        departmentIds,
        config,
      });
    }
  };

  if (!state) return null;

  return (
    <Drawer.Root
      open={true}
      placement="end"
      size="md"
      onOpenChange={(e) => {
        if (!e.open) onClose();
      }}
    >
      <Drawer.Content>
        <Drawer.Header>
          <Heading size="md">{isEdit ? "Edit tile" : "Add tile"}</Heading>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={4}>
            <FormSection label="Type">
              {isEdit ? (
                <Text fontSize="sm" color="fg.muted">
                  {TILE_TYPE_OPTIONS.find((o) => o.value === form.type)?.label}{" "}
                  (locked on edit)
                </Text>
              ) : (
                <HStack gap={3}>
                  {TILE_TYPE_OPTIONS.map((opt) => (
                    <RadioCard
                      key={opt.value}
                      label={opt.label}
                      checked={form.type === opt.value}
                      onSelect={() => {
                        const next = blankForm(opt.value);
                        setForm(next);
                        setIconAsset(deriveDefaultIconAsset(next));
                      }}
                    />
                  ))}
                </HStack>
              )}
            </FormSection>

            <FormSection
              label="Visible to"
              hint={
                departmentIds.length === 0
                  ? "Whole organization - every member sees this tile."
                  : `${departmentIds.length} department${departmentIds.length === 1 ? "" : "s"} - only members of these departments see it.`
              }
            >
              <ScopeChipPicker
                value={scopes}
                onChange={setScopes}
                organizationId={organizationId}
                organizationName={organization?.name ?? "Whole organization"}
                availableDepartments={departments}
                allowedScopeTypes={["ORGANIZATION", "DEPARTMENT"]}
                label=""
                showSummary={false}
              />
              {departments.length === 0 && (
                <Text fontSize="xs" color="fg.muted">
                  No departments yet. The tile stays visible to every member.
                  Create departments under{" "}
                  <Link
                    href="/settings/governance/departments"
                    color="blue.600"
                  >
                    Governance → Departments
                  </Link>{" "}
                  to scope tiles to a group of people.
                </Text>
              )}
            </FormSection>

            <FormSection label="Display name">
              <Input
                size="sm"
                placeholder="e.g. Claude Code"
                value={form.displayName}
                onChange={(e) =>
                  setForm({ ...form, displayName: e.target.value })
                }
              />
            </FormSection>

            {form.type === "coding_assistant" && (
              <CodingAssistantFields
                form={form}
                setForm={setForm}
                onAssistantKindChange={onAssistantKindChange}
                iconAsset={iconAsset}
                onIconAssetChange={setIconAsset}
              />
            )}
            {form.type === "model_provider" && (
              <ModelProviderFields
                form={form}
                setForm={setForm}
                providerOptions={providerOptionsQuery.data}
                providerOptionsLoading={providerOptionsQuery.isLoading}
                routingPolicyOptions={routingPolicyOptionsQuery.data}
                routingPolicyOptionsLoading={
                  routingPolicyOptionsQuery.isLoading
                }
              />
            )}
            {form.type === "external_tool" && (
              <ExternalToolFields
                form={form}
                setForm={setForm}
                iconAsset={iconAsset}
                onIconAssetChange={setIconAsset}
              />
            )}

            <HStack gap={2} marginTop={4}>
              <Spacer />
              <Button
                size="sm"
                onClick={onSave}
                disabled={!canSave || isPending}
              >
                {isPending
                  ? "Saving…"
                  : isEdit
                    ? "Save changes"
                    : "Save tile"}
              </Button>
            </HStack>
          </VStack>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

function FormSection({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <VStack align="stretch" gap={1}>
      <Text fontSize="sm" fontWeight="medium">
        {label}
      </Text>
      {hint && (
        <Text fontSize="xs" color="fg.muted">
          {hint}
        </Text>
      )}
      {children}
    </VStack>
  );
}

function RadioCard({
  label,
  checked,
  onSelect,
}: {
  label: string;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <Box
      borderWidth="1px"
      borderColor={checked ? "blue.500" : "border.muted"}
      backgroundColor={checked ? "blue.50" : "transparent"}
      borderRadius="sm"
      paddingX={3}
      paddingY={2}
      cursor="pointer"
      onClick={onSelect}
    >
      <Text fontSize="sm">{label}</Text>
    </Box>
  );
}

function IconPreview({
  iconAsset,
  fallback,
}: {
  iconAsset: string | null;
  fallback: React.ReactNode;
}) {
  if (iconAsset && isToolPresetAsset(iconAsset)) {
    const key = iconAsset.slice("preset:tool:".length) as
      | (typeof TOOL_KINDS)[number]
      | string;
    const preset = TOOL_PRESETS[key as (typeof TOOL_KINDS)[number]];
    if (preset) {
      const Icon = preset.Icon;
      return <Icon size={28} />;
    }
  }
  if (iconAsset?.startsWith(PRESET_PREFIX)) {
    const key = iconAsset.slice(PRESET_PREFIX.length);
    if (isAssistantKind(key) && key !== "custom") {
      const url = ASSISTANT_PRESETS[key].iconUrl;
      if (url) {
        return (
          <Image
            src={url}
            alt=""
            width="32px"
            height="32px"
            objectFit="contain"
            _dark={
              ASSISTANT_PRESETS[key].darkModeInvert
                ? { filter: "invert(1) hue-rotate(180deg)" }
                : undefined
            }
          />
        );
      }
    }
  }
  if (iconAsset?.startsWith(DATA_URL_PREFIX)) {
    return (
      <Image
        src={iconAsset}
        alt=""
        width="32px"
        height="32px"
        objectFit="contain"
      />
    );
  }
  return <>{fallback}</>;
}

function IconUploadButton({
  onUploaded,
  label = "Upload custom icon",
}: {
  onUploaded: (dataUrl: string) => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const onFile = (file: File) => {
    if (file.size > MAX_ICON_BASE64_BYTES) {
      toaster.create({
        title: "Icon too large",
        description: "Maximum upload size is 256 KB.",
        type: "error",
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        onUploaded(reader.result);
      }
    };
    reader.onerror = () => {
      toaster.create({
        title: "Failed to read file",
        type: "error",
      });
    };
    reader.readAsDataURL(file);
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/svg+xml,image/png,image/jpeg,image/webp"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />
      <Button
        size="sm"
        variant="outline"
        onClick={() => inputRef.current?.click()}
      >
        {label}
      </Button>
    </>
  );
}

function CodingAssistantFields({
  form,
  setForm,
  onAssistantKindChange,
  iconAsset,
  onIconAssetChange,
}: {
  form: CodingAssistantForm;
  setForm: (f: FormState) => void;
  onAssistantKindChange: (kind: AssistantKind) => void;
  iconAsset: string | null;
  onIconAssetChange: (value: string | null) => void;
}) {
  const isCustom = form.assistantKind === "custom";

  return (
    <>
      <FormSection label="Assistant">
        <HStack gap={3} align="center">
          <IconPreview iconAsset={iconAsset} fallback={<Bot size={28} />} />
          <NativeSelect.Root size="sm" flex={1}>
            <NativeSelect.Field
              value={form.assistantKind}
              onChange={(e) => {
                if (isAssistantKind(e.target.value)) {
                  onAssistantKindChange(e.target.value);
                }
              }}
            >
              {ASSISTANT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </HStack>
        {isCustom && (
          <HStack gap={2} marginTop={2}>
            <IconUploadButton
              onUploaded={onIconAssetChange}
              label={iconAsset ? "Replace icon" : "Upload icon (SVG / PNG)"}
            />
            {iconAsset?.startsWith(DATA_URL_PREFIX) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onIconAssetChange(null)}
              >
                Clear
              </Button>
            )}
          </HStack>
        )}
      </FormSection>
      <FormSection label="Setup command">
        <Input
          size="sm"
          placeholder="e.g. langwatch claude"
          value={form.setupCommand}
          onChange={(e) =>
            setForm({ ...form, setupCommand: e.target.value })
          }
        />
      </FormSection>
      <FormSection label="Helper text (optional)">
        <Textarea
          size="sm"
          rows={3}
          placeholder="What this command does, what it provisions, any prerequisites."
          value={form.helperText}
          onChange={(e) => setForm({ ...form, helperText: e.target.value })}
        />
      </FormSection>
      <FormSection label="Setup docs URL (optional)">
        <Input
          size="sm"
          placeholder="https://docs.example/setup"
          value={form.setupDocsUrl}
          onChange={(e) =>
            setForm({ ...form, setupDocsUrl: e.target.value })
          }
        />
      </FormSection>
      <CliPathsSection form={form} setForm={setForm} />
      <CostAttributionSection form={form} setForm={setForm} />
    </>
  );
}

/**
 * Cost attribution for traces this tool sends through the direct OTLP
 * ingestion path. Most coding assistants run on a bundled subscription
 * (e.g. Claude Max), so their list-price token cost is theoretical rather
 * than real spend. When this is on, the receiver tags those traces
 * non-billable, and the trace summary / analytics split billed vs non-billed
 * cost. Gateway / virtual-key usage is always billed and ignores this flag.
 */
function CostAttributionSection({
  form,
  setForm,
}: {
  form: CodingAssistantForm;
  setForm: (f: FormState) => void;
}) {
  return (
    <FormSection
      label="Cost attribution"
      hint="How usage from this tool counts toward spend. Only the direct OTLP path is affected; gateway usage is always billed per token."
    >
      <HStack justify="space-between">
        <VStack align="start" gap={0}>
          <Text fontSize="sm">Bundled subscription (not billed per token)</Text>
          <Text fontSize="xs" color="fg.muted">
            Direct-OTLP usage is included in a flat plan, so its cost is shown
            as theoretical rather than counted as real spend.
          </Text>
        </VStack>
        <Switch
          checked={form.bundledPlan}
          onCheckedChange={({ checked }) =>
            setForm({ ...form, bundledPlan: checked })
          }
        />
      </HStack>
    </FormSection>
  );
}

/**
 * CLI path policy for the `langwatch <tool>` wrapper, folded into the
 * coding-assistant tile (replaces the standalone PlatformToolPolicy table).
 * The CLI caches this at login (cliBootstrap's `toolPolicies` map) and only
 * offers the paths enabled here. Cursor is GUI-only, so its direct-OTLP
 * toggle is forced off and disabled.
 */
function CliPathsSection({
  form,
  setForm,
}: {
  form: CodingAssistantForm;
  setForm: (f: FormState) => void;
}) {
  const cursorOnly = form.assistantKind === "cursor";
  return (
    <FormSection
      label="CLI paths"
      hint="Which routes this tool may use when launched via the langwatch CLI. The CLI reads this at login."
    >
      <VStack align="stretch" gap={2}>
        <HStack justify="space-between">
          <VStack align="start" gap={0}>
            <Text fontSize="sm">Allow gateway (virtual key)</Text>
            <Text fontSize="xs" color="fg.muted">
              Route through the LangWatch gateway with a personal virtual key.
            </Text>
          </VStack>
          <Switch
            checked={form.allowVk}
            onCheckedChange={({ checked }) =>
              setForm({ ...form, allowVk: checked })
            }
          />
        </HStack>
        <HStack justify="space-between">
          <VStack align="start" gap={0}>
            <Text fontSize="sm">Allow direct OTLP ingestion</Text>
            <Text fontSize="xs" color="fg.muted">
              {cursorOnly
                ? "Cursor is GUI-only, so direct OTLP never applies."
                : "Export telemetry straight to the personal OTLP endpoint."}
            </Text>
          </VStack>
          <Switch
            checked={cursorOnly ? false : form.allowOtelDirect}
            disabled={cursorOnly}
            onCheckedChange={({ checked }) =>
              setForm({ ...form, allowOtelDirect: checked })
            }
          />
        </HStack>
      </VStack>
    </FormSection>
  );
}

function ModelProviderFields({
  form,
  setForm,
  providerOptions,
  providerOptionsLoading,
  routingPolicyOptions,
  routingPolicyOptionsLoading,
}: {
  form: ModelProviderForm;
  setForm: (f: FormState) => void;
  providerOptions:
    | Array<{ providerKey: string; displayName: string; configured: boolean }>
    | undefined;
  providerOptionsLoading: boolean;
  routingPolicyOptions: Array<{ id: string; name: string }> | undefined;
  routingPolicyOptionsLoading: boolean;
}) {
  const selectedProvider = providerOptions?.find(
    (p) => p.providerKey === form.providerKey,
  );

  return (
    <>
      <FormSection
        label="Provider"
        hint="Used to bind issued VKs to the right provider credential."
      >
        <NativeSelect.Root size="sm">
          <NativeSelect.Field
            value={form.providerKey}
            onChange={(e) =>
              setForm({ ...form, providerKey: e.target.value })
            }
          >
            <option value="">
              {providerOptionsLoading
                ? "Loading providers…"
                : "- select a provider -"}
            </option>
            {(providerOptions ?? []).map((p) => (
              <option key={p.providerKey} value={p.providerKey}>
                {p.displayName}
                {p.configured ? "" : " (not configured)"}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
        {selectedProvider && !selectedProvider.configured && (
          <Alert.Root status="warning" variant="surface" marginTop={2}>
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Provider not configured</Alert.Title>
              <Alert.Description fontSize="xs">
                This provider has no enabled credential yet. Tiles will publish
                but VK issuance will 502 until you{" "}
                <Link href="/settings/model-providers" color="orange.600">
                  configure it
                </Link>
                .
              </Alert.Description>
            </Alert.Content>
          </Alert.Root>
        )}
      </FormSection>
      <FormSection label="Default label suggestion (optional)">
        <Input
          size="sm"
          placeholder="my-app"
          value={form.defaultLabel}
          onChange={(e) =>
            setForm({ ...form, defaultLabel: e.target.value })
          }
        />
      </FormSection>
      <FormSection
        label="Routing policy (optional)"
        hint="If set, issued VKs will bind to this routing policy instead of the org default."
      >
        <NativeSelect.Root size="sm">
          <NativeSelect.Field
            value={form.suggestedRoutingPolicyId}
            onChange={(e) =>
              setForm({ ...form, suggestedRoutingPolicyId: e.target.value })
            }
          >
            <option value="">
              {routingPolicyOptionsLoading
                ? "Loading policies…"
                : "- use organization default -"}
            </option>
            {(routingPolicyOptions ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </FormSection>
      <FormSection label="Project-suggestion hint (optional)">
        <Textarea
          size="sm"
          rows={2}
          placeholder="Building an application for your team? Consider creating a project instead."
          value={form.projectSuggestionText}
          onChange={(e) =>
            setForm({ ...form, projectSuggestionText: e.target.value })
          }
        />
      </FormSection>
    </>
  );
}

function ExternalToolFields({
  form,
  setForm,
  iconAsset,
  onIconAssetChange,
}: {
  form: ExternalToolForm;
  setForm: (f: FormState) => void;
  iconAsset: string | null;
  onIconAssetChange: (value: string | null) => void;
}) {
  return (
    <>
      <FormSection
        label="Icon"
        hint="Pick a built-in icon or upload your own SVG / PNG."
      >
        <VStack align="stretch" gap={2}>
          <HStack gap={2} flexWrap="wrap">
            {TOOL_KINDS.map((kind) => {
              const preset = TOOL_PRESETS[kind];
              const Icon = preset.Icon;
              const value = toolPresetAsset(kind);
              const selected = iconAsset === value;
              return (
                <Button
                  key={kind}
                  type="button"
                  variant="outline"
                  onClick={() => onIconAssetChange(value)}
                  borderColor={selected ? "blue.500" : "border.muted"}
                  backgroundColor={selected ? "blue.50" : "transparent"}
                  borderRadius="sm"
                  paddingX={3}
                  paddingY={2}
                  height="auto"
                  display="flex"
                  alignItems="center"
                  gap={2}
                  aria-label={preset.label}
                  aria-pressed={selected}
                >
                  <Icon size={18} />
                  <Text fontSize="xs">{preset.label}</Text>
                </Button>
              );
            })}
          </HStack>
          <HStack gap={2} align="center">
            <IconPreview iconAsset={iconAsset} fallback={<Wrench size={28} />} />
            <IconUploadButton
              onUploaded={onIconAssetChange}
              label={
                iconAsset?.startsWith(DATA_URL_PREFIX)
                  ? "Replace uploaded icon"
                  : "Upload custom icon"
              }
            />
            {iconAsset?.startsWith(DATA_URL_PREFIX) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onIconAssetChange(toolPresetAsset("wrench"))}
              >
                Use default
              </Button>
            )}
          </HStack>
        </VStack>
      </FormSection>
      <FormSection
        label="Description (markdown)"
        hint="Rendered in the tile body when end users expand it. Markdown is sanitized."
      >
        <Textarea
          size="sm"
          rows={6}
          placeholder={"Microsoft's low-code agent builder...\n\n# Getting started\n- Request access in #..."}
          value={form.descriptionMarkdown}
          onChange={(e) =>
            setForm({ ...form, descriptionMarkdown: e.target.value })
          }
        />
      </FormSection>
      <FormSection label="Link URL">
        <Input
          size="sm"
          placeholder="https://copilotstudio.microsoft.com"
          value={form.linkUrl}
          onChange={(e) => setForm({ ...form, linkUrl: e.target.value })}
        />
      </FormSection>
      <FormSection label="CTA label (optional)">
        <Input
          size="sm"
          placeholder="Open Copilot Studio (defaults to 'Open <name>')"
          value={form.ctaLabel}
          onChange={(e) => setForm({ ...form, ctaLabel: e.target.value })}
        />
      </FormSection>
    </>
  );
}

