import {
  Box,
  Button,
  Heading,
  HStack,
  Input,
  Spacer,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";

import { Drawer } from "~/components/ui/drawer";
import { toaster } from "~/components/ui/toaster";
import { api } from "~/utils/api";

import type {
  AiToolEntry,
  AiToolScope,
  AiToolTileType,
} from "~/components/me/tiles/types";

const TILE_TYPE_OPTIONS: Array<{ value: AiToolTileType; label: string }> = [
  { value: "coding_assistant", label: "Coding assistant" },
  { value: "model_provider", label: "Model provider" },
  { value: "external_tool", label: "Internal tool" },
];

const SCOPE_OPTIONS: Array<{ value: AiToolScope; label: string }> = [
  { value: "organization", label: "Whole organization" },
  { value: "team", label: "Specific team" },
];

interface CodingAssistantForm {
  type: "coding_assistant";
  displayName: string;
  slug: string;
  setupCommand: string;
  helperText: string;
  setupDocsUrl: string;
}

interface ModelProviderForm {
  type: "model_provider";
  displayName: string;
  slug: string;
  providerKey: string;
  defaultLabel: string;
  suggestedRoutingPolicyId: string;
  projectSuggestionText: string;
}

interface ExternalToolForm {
  type: "external_tool";
  displayName: string;
  slug: string;
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
      slug: "",
      setupCommand: "",
      helperText: "",
      setupDocsUrl: "",
    };
  }
  if (type === "model_provider") {
    return {
      type,
      displayName: "",
      slug: "",
      providerKey: "",
      defaultLabel: "",
      suggestedRoutingPolicyId: "",
      projectSuggestionText: "",
    };
  }
  return {
    type,
    displayName: "",
    slug: "",
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
    return {
      type: "coding_assistant",
      displayName: entry.displayName,
      slug: entry.slug,
      setupCommand: baseStr("setupCommand"),
      helperText: baseStr("helperText"),
      setupDocsUrl: baseStr("setupDocsUrl"),
    };
  }
  if (entry.type === "model_provider") {
    return {
      type: "model_provider",
      displayName: entry.displayName,
      slug: entry.slug,
      providerKey: baseStr("providerKey"),
      defaultLabel: baseStr("defaultLabel"),
      suggestedRoutingPolicyId: baseStr("suggestedRoutingPolicyId"),
      projectSuggestionText: baseStr("projectSuggestionText"),
    };
  }
  return {
    type: "external_tool",
    displayName: entry.displayName,
    slug: entry.slug,
    descriptionMarkdown: baseStr("descriptionMarkdown"),
    linkUrl: baseStr("linkUrl"),
    ctaLabel: baseStr("ctaLabel"),
  };
}

function configFromForm(form: FormState): Record<string, unknown> {
  if (form.type === "coding_assistant") {
    return {
      setupCommand: form.setupCommand.trim(),
      ...(form.helperText.trim() ? { helperText: form.helperText.trim() } : {}),
      ...(form.setupDocsUrl.trim()
        ? { setupDocsUrl: form.setupDocsUrl.trim() }
        : {}),
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

interface Props {
  organizationId: string;
  state:
    | { mode: "create"; type: AiToolTileType }
    | { mode: "edit"; entry: AiToolEntry }
    | null;
  onClose: () => void;
}

export function AiToolEntryDrawer({ organizationId, state, onClose }: Props) {
  const utils = api.useUtils();
  const [form, setForm] = useState<FormState>(() =>
    state?.mode === "edit"
      ? formFromEntry(state.entry)
      : blankForm(state?.type ?? "coding_assistant"),
  );
  const [scope, setScope] = useState<AiToolScope>(
    state?.mode === "edit" ? state.entry.scope : "organization",
  );
  const [scopeId, setScopeId] = useState<string>(
    state?.mode === "edit" ? state.entry.scopeId : organizationId,
  );

  // When the drawer opens for a different entry/type, reset state
  useEffect(() => {
    if (!state) return;
    setForm(
      state.mode === "edit"
        ? formFromEntry(state.entry)
        : blankForm(state.type),
    );
    setScope(state.mode === "edit" ? state.entry.scope : "organization");
    setScopeId(
      state.mode === "edit" ? state.entry.scopeId : organizationId,
    );
  }, [state, organizationId]);

  const isEdit = state?.mode === "edit";

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
    if (!form.displayName.trim() || !form.slug.trim()) return false;
    if (scope === "team" && !scopeId.trim()) return false;
    if (form.type === "coding_assistant" && !form.setupCommand.trim()) {
      return false;
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
  }, [form, scope, scopeId]);

  const onSave = () => {
    if (!canSave || !state) return;
    const config = configFromForm(form);
    if (state.mode === "create") {
      createMutation.mutate({
        organizationId,
        scope,
        scopeId,
        type: form.type,
        displayName: form.displayName.trim(),
        slug: form.slug.trim(),
        config,
      });
    } else {
      updateMutation.mutate({
        organizationId,
        id: state.entry.id,
        type: form.type,
        displayName: form.displayName.trim(),
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
                      onSelect={() => setForm(blankForm(opt.value))}
                    />
                  ))}
                </HStack>
              )}
            </FormSection>

            <FormSection label="Display name">
              <Input
                size="sm"
                placeholder="Claude Code"
                value={form.displayName}
                onChange={(e) =>
                  setForm({ ...form, displayName: e.target.value })
                }
              />
            </FormSection>

            <FormSection
              label="Slug"
              hint="Lowercase alphanumeric, dash, or underscore (no spaces). Used for icon lookup and team-overrides-org matching."
            >
              <Input
                size="sm"
                placeholder="claude-code"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
              />
            </FormSection>

            {form.type === "coding_assistant" && (
              <CodingAssistantFields form={form} setForm={setForm} />
            )}
            {form.type === "model_provider" && (
              <ModelProviderFields form={form} setForm={setForm} />
            )}
            {form.type === "external_tool" && (
              <ExternalToolFields form={form} setForm={setForm} />
            )}

            <FormSection label="Scope">
              <HStack gap={3}>
                {SCOPE_OPTIONS.map((opt) => (
                  <RadioCard
                    key={opt.value}
                    label={opt.label}
                    checked={scope === opt.value}
                    onSelect={() => {
                      setScope(opt.value);
                      if (opt.value === "organization") {
                        setScopeId(organizationId);
                      } else {
                        setScopeId("");
                      }
                    }}
                  />
                ))}
              </HStack>
              {scope === "team" && (
                <Input
                  size="sm"
                  placeholder="team_xxxxxxxx (paste team id)"
                  value={scopeId}
                  onChange={(e) => setScopeId(e.target.value)}
                  marginTop={2}
                />
              )}
            </FormSection>
            <HStack gap={2} marginTop={4}>
              <Button variant="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
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

function CodingAssistantFields({
  form,
  setForm,
}: {
  form: CodingAssistantForm;
  setForm: (f: FormState) => void;
}) {
  return (
    <>
      <FormSection label="Setup command">
        <Input
          size="sm"
          placeholder="langwatch claude"
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
    </>
  );
}

function ModelProviderFields({
  form,
  setForm,
}: {
  form: ModelProviderForm;
  setForm: (f: FormState) => void;
}) {
  return (
    <>
      <FormSection
        label="Provider key"
        hint="e.g. anthropic, openai, bedrock — used to bind issued VKs to the right provider credential."
      >
        <Input
          size="sm"
          placeholder="anthropic"
          value={form.providerKey}
          onChange={(e) => setForm({ ...form, providerKey: e.target.value })}
        />
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
        label="Suggested routing policy id (optional)"
        hint="If set, issued VKs will bind to this routing policy instead of the org default."
      >
        <Input
          size="sm"
          placeholder="rp_..."
          value={form.suggestedRoutingPolicyId}
          onChange={(e) =>
            setForm({ ...form, suggestedRoutingPolicyId: e.target.value })
          }
        />
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
}: {
  form: ExternalToolForm;
  setForm: (f: FormState) => void;
}) {
  return (
    <>
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
