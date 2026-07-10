import {
  Box,
  Button,
  createListCollection,
  Field,
  Input,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import { FaSlack } from "react-icons/fa";
import { Select } from "~/components/ui/select";
import { VariableInfoIcon } from "~/features/automations/components/VariableInfoIcon";
import { LIQUID_JSON_LANGUAGE_ID } from "~/features/automations/editors/liquidMonaco";
import { SLACK_BLOCK_KIT_JSON_SCHEMA } from "~/features/automations/editors/monacoSchemas";
import {
  CompactSlackPreview,
  FieldHeader,
  LiquidEditor,
  TemplateDisclosure,
} from "~/features/automations/editors/templateAuthoring";
import {
  DEFAULT_ALERT_SLACK_BLOCK_KIT_TEMPLATE,
  DEFAULT_ALERT_SLACK_TEMPLATE,
  DEFAULT_SLACK_BLOCK_KIT_TEMPLATE,
  DEFAULT_SLACK_TEMPLATE,
} from "~/shared/templating/defaults";
import { filterVariablesForCadence } from "~/shared/templating/exampleContext";
import { api } from "~/utils/api";
import { InlineCadenceSelect } from "../../components/InlineCadenceSelect";
import type {
  ConfigFormProps,
  NotifyClientDef,
  SavedTriggerRow,
  SummaryIdentity,
} from "../../types";
import type {
  SlackActionParams,
  SlackPreview,
  SlackTemplateType,
} from "./shared";
import { findTemplateOptionBySource } from "./templates/registry";
import { SlackBlockKitTemplatePicker } from "./templates/TemplatePicker";

interface FieldDraft {
  value: string;
  usingDefault: boolean;
}

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
    templateType:
      row.slackTemplateType === "block_kit" ? "block_kit" : "string",
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
  return { webhook: slice.webhook || null };
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
  // Graph-alert drafts dispatch with the alert defaults, so the editor
  // must seed the same template — otherwise the shown template and the
  // rendered message disagree.
  const isGraphAlert = ctx.sourceKind === "graphAlert";
  const templateDefault = isBlockKit
    ? isGraphAlert
      ? DEFAULT_ALERT_SLACK_BLOCK_KIT_TEMPLATE
      : DEFAULT_SLACK_BLOCK_KIT_TEMPLATE
    : isGraphAlert
      ? DEFAULT_ALERT_SLACK_TEMPLATE
      : DEFAULT_SLACK_TEMPLATE;
  const templateValue = slice.template.usingDefault
    ? templateDefault
    : slice.template.value;
  const slackPreview = ctx.preview;
  const variables = useMemo(
    () => filterVariablesForCadence(ctx.variables, ctx.cadenceMode),
    [ctx.variables, ctx.cadenceMode],
  );

  // A returning author who hand-edited the Block Kit source (not a preset,
  // not the framework default) lands with the code editor already open so
  // their custom layout is visible; everyone else starts on the gallery.
  const isCustomBlockKit =
    isBlockKit &&
    !slice.template.usingDefault &&
    !findTemplateOptionBySource(slice.template.value);
  const [codeOpen, setCodeOpen] = useState(isCustomBlockKit);

  // If the cadence or trigger kind switches away from what the picked
  // preset was built for (immediate template on a digest dispatch, trace
  // template on a graph alert, or vice versa), the source would render
  // empty/first-match-only bodies. Reset to the framework default so the
  // editor shows a template that fits the new draft.
  useEffect(() => {
    if (slice.template.usingDefault) return;
    const preset = findTemplateOptionBySource(slice.template.value);
    if (!preset) return;
    const cadenceMismatch =
      preset.cadenceFit !== "both" && preset.cadenceFit !== ctx.cadenceMode;
    const kindMismatch = preset.kind !== ctx.sourceKind;
    if (!cadenceMismatch && !kindMismatch) return;
    onChange({ ...slice, template: EMPTY_FIELD });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.cadenceMode, ctx.sourceKind]);

  const usePlainText = () =>
    onChange({ ...slice, templateType: "string", template: EMPTY_FIELD });
  const useGuidedTemplates = () =>
    onChange({ ...slice, templateType: "block_kit", template: EMPTY_FIELD });

  return (
    <VStack align="stretch" gap={4}>
      {/* Alerts always deliver immediately (cadence is pinned server-side),
          so the cadence switch only renders for trace automations. */}
      {!isGraphAlert ? (
        <InlineCadenceSelect
          value={ctx.notificationCadence}
          onChange={ctx.setNotificationCadence}
        />
      ) : null}
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
        label="Message"
        usingDefault={slice.template.usingDefault}
        onReset={() => onChange({ ...slice, template: EMPTY_FIELD })}
        trailing={<VariableInfoIcon variables={variables} />}
      />
      {isBlockKit ? (
        // Default tier: the guided gallery is the primary surface. The
        // author picks a ready-made layout and sees a preview; the plain
        // text and code escape hatches sit below as opt-ins.
        <VStack align="stretch" gap={3}>
          <SlackBlockKitTemplatePicker
            cadence={ctx.cadenceMode}
            kind={ctx.sourceKind}
            hasEvaluationFilter={ctx.hasEvaluationFilter}
            currentSource={templateValue}
            onSelect={(option) =>
              onChange({
                ...slice,
                template: { value: option.source, usingDefault: false },
              })
            }
            onSelectOtherCadence={(option) => {
              // Cross-cadence pick: switch the cadence alongside the template
              // so the author doesn't have to round-trip via the Cadence
              // section. Both land in the same batch, so the cadence-mismatch
              // reset effect above sees a consistent pair and leaves it alone.
              ctx.setNotificationCadence(
                option.cadenceFit === "digest" ? "5min_digest" : "immediate",
              );
              onChange({
                ...slice,
                template: { value: option.source, usingDefault: false },
              });
            }}
          />
          {slackPreview ? (
            <CompactSlackPreview payload={slackPreview.payload} />
          ) : null}
          {/* Escape hatch 1: write the message yourself as plain text. */}
          <Button
            variant="plain"
            size="xs"
            width="fit-content"
            paddingX={0}
            color="fg.muted"
            _hover={{ color: "fg" }}
            onClick={usePlainText}
          >
            Write the message as plain text instead
          </Button>
          {/* Escape hatch 2: the raw Block Kit editor. This is the only
              place "Block Kit" and Liquid braces are exposed — everything
              above stays no-code. The `liquid-json` Monaco language tokenizes
              the JSON and its embedded Liquid, and the Block Kit schema drives
              in-editor markers. */}
          <TemplateDisclosure
            triggerLabel="Edit as code"
            hint="Write the layout yourself in Block Kit. Values in braces fill in from your trace or alert when the message sends."
            open={codeOpen}
            onToggle={() => setCodeOpen((prev) => !prev)}
          >
            <Box data-testid="slack-code-editor">
              <LiquidEditor
                variables={variables}
                height="320px"
                language={LIQUID_JSON_LANGUAGE_ID}
                value={templateValue}
                onChange={(value) =>
                  onChange({
                    ...slice,
                    template: { value, usingDefault: false },
                  })
                }
                jsonSchema={SLACK_BLOCK_KIT_JSON_SCHEMA}
                jsonSchemaShadowUri="file:///automation/slack-block-kit-shadow.json"
              />
            </Box>
          </TemplateDisclosure>
        </VStack>
      ) : (
        // "Edit text" tier: a plain text Slack message, no Block Kit JSON.
        <VStack align="stretch" gap={3}>
          <Text textStyle="xs" color="fg.muted">
            Write the message Slack will post. Markdown and variables are
            supported.
          </Text>
          <Box data-testid="slack-text-editor">
            <LiquidEditor
              variables={variables}
              height="200px"
              value={templateValue}
              onChange={(value) =>
                onChange({
                  ...slice,
                  template: { value, usingDefault: false },
                })
              }
            />
          </Box>
          {slackPreview ? (
            <CompactSlackPreview payload={slackPreview.payload} />
          ) : null}
          <Button
            variant="plain"
            size="xs"
            width="fit-content"
            paddingX={0}
            color="fg.muted"
            _hover={{ color: "fg" }}
            onClick={useGuidedTemplates}
          >
            Use a guided template instead
          </Button>
        </VStack>
      )}
    </VStack>
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
  Icon: FaSlack,
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
