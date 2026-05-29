import {
  Box,
  Field,
  HStack,
  Input,
  NativeSelect,
  Text,
  VStack,
} from "@chakra-ui/react";
import { SiSlack } from "react-icons/si";
import { LIQUID_JSON_LANGUAGE_ID } from "~/features/automations/editors/liquidMonaco";
import { SLACK_BLOCK_KIT_JSON_SCHEMA } from "~/features/automations/editors/monacoSchemas";
import {
  ExampleData,
  FieldHeader,
  LiquidEditor,
  PreviewWarnings,
  SlackPreview as SlackPreviewView,
  VariableReference,
} from "~/features/automations/editors/templateAuthoring";
import {
  DEFAULT_SLACK_BLOCK_KIT_TEMPLATE,
  DEFAULT_SLACK_TEMPLATE,
} from "~/features/automations/templates/scaffold";
import type {
  ConfigFormProps,
  NotifyClientDef,
  SavedTriggerRow,
  SummaryIdentity,
} from "../../types";
import { type SlackActionParams, type SlackPreview } from "./shared";

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
  return { webhook: "", templateType: "string", template: EMPTY_FIELD };
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
    slackTemplateType: slice.template.usingDefault ? null : slice.templateType,
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

  return (
    <VStack align="stretch" gap={4}>
      <Field.Root>
        <Field.Label>Slack webhook URL</Field.Label>
        <Input
          value={slice.webhook}
          onChange={(e) => onChange({ ...slice, webhook: e.target.value })}
          placeholder="https://hooks.slack.com/services/..."
        />
      </Field.Root>
      <Field.Root>
        <Field.Label>Message type</Field.Label>
        <NativeSelect.Root>
          <NativeSelect.Field
            value={slice.templateType}
            onChange={(e) =>
              // Reset template to default when toggling type so the right
              // default shows in the editor.
              onChange({
                ...slice,
                templateType: e.target.value as SlackTemplateType,
                template: EMPTY_FIELD,
              })
            }
          >
            <option value="string">Plain text</option>
            <option value="block_kit">Block Kit (JSON)</option>
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </Field.Root>
      <FieldHeader
        label={
          isBlockKit
            ? "Block Kit template (JSON + Liquid in strings)"
            : "Message template (Liquid)"
        }
        usingDefault={slice.template.usingDefault}
        onReset={() => onChange({ ...slice, template: EMPTY_FIELD })}
      />
      {/* Block Kit templates are JSON whose string values contain Liquid.
          We use the custom `liquid-json` Monaco language so the editor
          tokenizes both, and we pass the Block Kit schema down — the
          editor pre-substitutes Liquid spans with same-length placeholders
          and runs the JSON language service on the synthetic text so the
          author still gets in-editor schema markers. */}
      <LiquidEditor
        variables={ctx.variables}
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

      <Box border="1px solid" borderColor="border" borderRadius="md" padding={3}>
        <Text textStyle="sm" fontWeight="semibold" mb={2}>
          Preview
        </Text>
        <PreviewWarnings data={slackPreview} />
        {slackPreview ? (
          <SlackPreviewView payload={slackPreview.payload} />
        ) : (
          <Text color="fg.muted" textStyle="sm">
            Edit a template to preview.
          </Text>
        )}
      </Box>

      <VariableReference variables={ctx.variables} />
      <ExampleData example={ctx.example} />
    </VStack>
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
