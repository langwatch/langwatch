import { Button, createListCollection, Field, HStack, Input, Text, VStack } from "@chakra-ui/react";
import { useEffect, useMemo } from "react";
import { SiSlack } from "react-icons/si";
import { Select } from "~/components/ui/select";
import { api } from "~/utils/api";
import { VariableInfoIcon } from "~/features/automations/components/VariableInfoIcon";
import { LIQUID_JSON_LANGUAGE_ID } from "~/features/automations/editors/liquidMonaco";
import { SLACK_BLOCK_KIT_JSON_SCHEMA } from "~/features/automations/editors/monacoSchemas";
import {
  CompactSlackPreview,
  FieldHeader,
  LiquidEditor,
} from "~/features/automations/editors/templateAuthoring";
import {
  DEFAULT_SLACK_BLOCK_KIT_TEMPLATE,
  DEFAULT_SLACK_TEMPLATE,
} from "~/shared/templating/defaults";
import { filterVariablesForCadence } from "~/shared/templating/exampleContext";
import { InlineCadenceSelect } from "../../components/InlineCadenceSelect";
import type {
  ConfigFormProps,
  NotifyClientDef,
  SavedTriggerRow,
  SummaryIdentity,
} from "../../types";
import { type SlackActionParams, type SlackPreview } from "./shared";
import { findTemplateOptionBySource } from "./templates/registry";
import { SlackBlockKitTemplatePicker } from "./templates/TemplatePicker";

interface FieldDraft {
  value: string;
  usingDefault: boolean;
}

export type SlackTemplateType = "string" | "block_kit";

export interface SlackSlice {
  webhook: string;
  templateType: SlackTemplateType;
  template: FieldDraft;
}

const EMPTY_FIELD: FieldDraft = { value: "", usingDefault: true };

function initialSlice(): SlackSlice {
  // Block Kit is the default for new Slack automations — the framework
  // ships pre-built layouts the user can pick from, and it renders much
  // better in Slack than the plain-text fallback. Existing rows whose
  // `slackTemplateType` is null are read as plain text upstream
  // (`fromTriggerRow`) so we don't accidentally retype historical configs.
  return { webhook: "", templateType: "block_kit", template: EMPTY_FIELD };
}

function isComplete(slice: SlackSlice): boolean {
  return slice.webhook.trim().length > 0;
}

function summary(slice: SlackSlice, identity: SummaryIdentity): string {
  const name = identity.name || "(unnamed)";
  return `${name} → Slack webhook${slice.webhook ? " set" : " (not set)"}`;
}

function fromTriggerRow(row: SavedTriggerRow): SlackSlice {
  const params = (row.actionParams ?? {}) as Partial<SlackActionParams>;
  return {
    webhook: typeof params.slackWebhook === "string" ? params.slackWebhook : "",
    templateType: row.slackTemplateType === "block_kit" ? "block_kit" : "string",
    template: {
      value: row.slackTemplate ?? "",
      usingDefault: row.slackTemplate == null,
    },
  };
}

function toActionParams(slice: SlackSlice): SlackActionParams {
  return { slackWebhook: slice.webhook };
}

function testFireTarget(slice: SlackSlice) {
  return { recipients: [], webhook: slice.webhook || null };
}

function templatesFromSlice(slice: SlackSlice) {
  return {
    emailSubjectTemplate: null,
    emailBodyTemplate: null,
    slackTemplate: slice.template.usingDefault ? null : slice.template.value,
    // Always carry the toggle. A null `slackTemplate` paired with a
    // non-null `slackTemplateType` means "use the framework default for
    // this type" — without this the server can't tell apart a user who
    // wants the block_kit default from a user who wants the plain-text
    // default, and falls back to text either way.
    slackTemplateType: slice.templateType,
  };
}

function SlackConfigForm({
  slice,
  onChange,
  ctx,
}: ConfigFormProps<SlackSlice, SlackPreview>) {
  const isBlockKit = slice.templateType === "block_kit";
  const templateDefault = isBlockKit
    ? DEFAULT_SLACK_BLOCK_KIT_TEMPLATE
    : DEFAULT_SLACK_TEMPLATE;
  const templateValue = slice.template.usingDefault
    ? templateDefault
    : slice.template.value;
  const slackPreview = ctx.preview;
  const variables = useMemo(
    () => filterVariablesForCadence(ctx.variables, ctx.cadenceMode),
    [ctx.variables, ctx.cadenceMode],
  );

  // If the cadence switches away from the one the picked preset was built
  // for (immediate template on a digest dispatch or vice versa), the source
  // would render empty/first-match-only bodies. Reset to the framework
  // default so the editor shows a template that fits the new cadence.
  useEffect(() => {
    if (slice.template.usingDefault) return;
    const preset = findTemplateOptionBySource(slice.template.value);
    if (!preset) return;
    if (preset.cadenceFit === "both" || preset.cadenceFit === ctx.cadenceMode)
      return;
    onChange({ ...slice, template: EMPTY_FIELD });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.cadenceMode]);

  return (
    <VStack align="stretch" gap={4}>
      <InlineCadenceSelect
        value={ctx.notificationCadence}
        onChange={ctx.setNotificationCadence}
      />
      <Field.Root>
        <Field.Label>Slack webhook URL</Field.Label>
        <Input
          value={slice.webhook}
          onChange={(e) => onChange({ ...slice, webhook: e.target.value })}
          placeholder="https://hooks.slack.com/services/..."
        />
        <ReuseSlackWebhook
          projectId={ctx.projectId}
          currentWebhook={slice.webhook}
          onPick={(webhook) => onChange({ ...slice, webhook })}
        />
      </Field.Root>
      <FieldHeader
        label="Message template"
        usingDefault={slice.template.usingDefault}
        onReset={() => onChange({ ...slice, template: EMPTY_FIELD })}
        trailing={
          <HStack gap={2}>
            <MessageTypeToggle
              value={slice.templateType}
              onChange={(next) =>
                // Reset template to default when toggling type so the right
                // default shows in the editor.
                onChange({
                  ...slice,
                  templateType: next,
                  template: EMPTY_FIELD,
                })
              }
            />
            <VariableInfoIcon variables={variables} />
          </HStack>
        }
      />
      {isBlockKit ? (
        <SlackBlockKitTemplatePicker
          cadence={ctx.cadenceMode}
          hasEvaluationFilter={ctx.hasEvaluationFilter}
          currentSource={templateValue}
          onSelect={(option) =>
            onChange({
              ...slice,
              template: { value: option.source, usingDefault: false },
            })
          }
        />
      ) : null}
      {/* Block Kit templates are JSON whose string values contain Liquid.
          We use the custom `liquid-json` Monaco language so the editor
          tokenizes both, and we pass the Block Kit schema down — the
          editor pre-substitutes Liquid spans with same-length placeholders
          and runs the JSON language service on the synthetic text so the
          author still gets in-editor schema markers. */}
      <LiquidEditor
        variables={variables}
        height="320px"
        language={isBlockKit ? LIQUID_JSON_LANGUAGE_ID : undefined}
        value={templateValue}
        onChange={(value) =>
          onChange({ ...slice, template: { value, usingDefault: false } })
        }
        jsonSchema={isBlockKit ? SLACK_BLOCK_KIT_JSON_SCHEMA : undefined}
        jsonSchemaShadowUri={
          isBlockKit
            ? "file:///automation/slack-block-kit-shadow.json"
            : undefined
        }
      />

      {slackPreview ? <CompactSlackPreview payload={slackPreview.payload} /> : null}
    </VStack>
  );
}

/**
 * Compact two-state segmented control for "plain text" vs "block_kit".
 * Lives inside the template field header so we don't burn a full row on a
 * binary choice — saves vertical space in a drawer that already crams a
 * webhook input, the editor, and the preview.
 */
function MessageTypeToggle({
  value,
  onChange,
}: {
  value: SlackTemplateType;
  onChange: (next: SlackTemplateType) => void;
}) {
  return (
    <HStack
      gap={0}
      border="1px solid"
      borderColor="border"
      borderRadius="md"
      padding="2px"
    >
      <Button
        size="2xs"
        variant={value === "string" ? "solid" : "ghost"}
        colorPalette={value === "string" ? "orange" : undefined}
        onClick={() => onChange("string")}
      >
        Text
      </Button>
      <Button
        size="2xs"
        variant={value === "block_kit" ? "solid" : "ghost"}
        colorPalette={value === "block_kit" ? "orange" : undefined}
        onClick={() => onChange("block_kit")}
      >
        Block Kit
      </Button>
    </HStack>
  );
}

/**
 * Picks an existing Slack webhook off another automation in the same
 * project. Most teams share a single Slack channel for alerts, and forcing
 * the operator to copy the URL out of one automation row and paste it into
 * the next is friction with no upside — the URL is the same secret across
 * triggers. Hidden when no other Slack automation exists so it doesn't
 * advertise an empty menu.
 */
function ReuseSlackWebhook({
  projectId,
  currentWebhook,
  onPick,
}: {
  projectId: string;
  currentWebhook: string;
  onPick: (webhook: string) => void;
}) {
  const triggersQuery = api.automation.getTriggers.useQuery(
    { projectId },
    { enabled: !!projectId, refetchOnWindowFocus: false },
  );

  const options = useMemo(() => {
    const seen = new Set<string>();
    const out: { value: string; label: string }[] = [];
    for (const t of triggersQuery.data ?? []) {
      if (t.action !== "SEND_SLACK_MESSAGE") continue;
      const params = (t.actionParams ?? {}) as { slackWebhook?: string };
      const url = params.slackWebhook;
      if (!url) continue;
      if (url === currentWebhook) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({
        value: url,
        // The owning trigger's name is the only thing that distinguishes
        // webhooks without leaking the full URL (the hostname is always
        // hooks.slack.com).
        label: t.name,
      });
    }
    return out;
  }, [triggersQuery.data, currentWebhook]);

  const collection = useMemo(
    () => createListCollection({ items: options }),
    [options],
  );

  if (triggersQuery.isLoading) return null;
  if (options.length === 0) return null;

  return (
    <Select.Root
      collection={collection}
      value={[]}
      onValueChange={({ value }) => {
        const next = value[0];
        if (next) onPick(next);
      }}
      mt={2}
    >
      <Select.Trigger>
        <Select.ValueText placeholder="Reuse webhook from another automation…" />
      </Select.Trigger>
      <Select.Content>
        {options.map((opt) => (
          <Select.Item key={opt.value} item={opt}>
            <Text>{opt.label}</Text>
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}

const client: NotifyClientDef<SlackSlice, SlackPreview> = {
  Icon: SiSlack,
  channel: "slack",
  initialSlice,
  isComplete,
  summary,
  fromTriggerRow,
  toActionParams,
  testFireTarget,
  templatesFromSlice,
  ConfigForm: SlackConfigForm,
};

export default client;
