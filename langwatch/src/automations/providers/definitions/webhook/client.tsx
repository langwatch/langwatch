import { Box, Field, Input, Text, VStack } from "@chakra-ui/react";
import { Webhook } from "lucide-react";
import { useMemo } from "react";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { VariableInfoIcon } from "~/features/automations/components/VariableInfoIcon";
import { LIQUID_JSON_LANGUAGE_ID } from "~/features/automations/editors/liquidMonaco";
import {
  FieldHeader,
  LiquidEditor,
} from "~/features/automations/editors/templateAuthoring";
import { defaultsForSourceKind } from "~/shared/templating/defaults";
import { filterVariablesForCadence } from "~/shared/templating/exampleContext";
import { TestFireButton } from "../../components/TestFireButton";
import type { ConfigFormProps, NotifyClientDef } from "../../types";
import { HeadersEditor } from "./HeadersEditor";
import { LastTestResult } from "./LastTestResult";
import { validateWebhookUrlShape, WEBHOOK_METHODS } from "./shared";
import type { WebhookMethod, WebhookPreview } from "./shared";
import {
  EMPTY_FIELD,
  fromTriggerRow,
  initialSlice,
  isComplete,
  summary,
  templatesFromSlice,
  testFireTarget,
  toActionParams,
  type WebhookSlice,
} from "./slice";

const METHOD_ITEMS = WEBHOOK_METHODS.map((m) => ({ value: m, label: m }));

function WebhookConfigForm({
  slice,
  onChange,
  ctx,
}: ConfigFormProps<WebhookSlice, WebhookPreview>) {
  const urlProblem =
    slice.url.trim() === "" ? null : validateWebhookUrlShape(slice.url.trim());
  const defaults = defaultsForSourceKind(ctx.sourceKind);
  const templateValue = slice.template.value || defaults.webhookBody;
  const variables = useMemo(
    () => filterVariablesForCadence(ctx.variables, ctx.cadenceMode),
    [ctx.variables, ctx.cadenceMode],
  );
  const preview = ctx.preview;

  return (
    <VStack align="stretch" gap={4}>
      <Field.Root invalid={!!urlProblem}>
        <Field.Label>Endpoint URL</Field.Label>
        <Input
          value={slice.url}
          onChange={(e) => onChange({ ...slice, url: e.target.value })}
          placeholder="https://example.com/hooks/langwatch"
        />
        {urlProblem ? (
          <Field.ErrorText>{urlProblem}</Field.ErrorText>
        ) : (
          <Field.HelperText>
            An https endpoint you control. The request body is JSON.
          </Field.HelperText>
        )}
      </Field.Root>
      <Field.Root>
        <Field.Label>Method</Field.Label>
        <SegmentedControl
          size="sm"
          value={slice.method}
          onValueChange={({ value }) => {
            if (value) onChange({ ...slice, method: value as WebhookMethod });
          }}
          items={METHOD_ITEMS}
        />
      </Field.Root>
      <HeadersEditor slice={slice} onChange={onChange} />
      {/* Try the real request straight from the destination section; the
          outcome (status code / failure) lands right below the button. */}
      <VStack align="start" gap={2}>
        <TestFireButton
          onTestFire={ctx.onTestFire}
          loading={ctx.testFireLoading}
          disabled={!isComplete(slice)}
          hint={isComplete(slice) ? undefined : "Add a valid https URL first"}
        />
        <LastTestResult attempt={ctx.lastTestAttempt} />
      </VStack>
      <FieldHeader
        label="JSON body"
        usingDefault={slice.template.usingDefault}
        onReset={() => onChange({ ...slice, template: EMPTY_FIELD })}
        trailing={<VariableInfoIcon variables={variables} />}
      />
      <VStack align="stretch" gap={2}>
        <Text textStyle="xs" color="fg.muted">
          Write the JSON your endpoint receives. Values in braces fill in from
          your trace or alert when the request sends.
        </Text>
        <Box data-testid="webhook-body-editor">
          <LiquidEditor
            variables={variables}
            height="280px"
            language={LIQUID_JSON_LANGUAGE_ID}
            value={templateValue}
            onChange={(value) =>
              onChange({ ...slice, template: { value, usingDefault: false } })
            }
          />
        </Box>
        {preview ? (
          <Box
            borderWidth="1px"
            borderColor="border.muted"
            borderRadius="md"
            bg="bg.subtle"
            padding={3}
            data-testid="webhook-preview"
          >
            <Text textStyle="xs" fontWeight="medium" color="fg.muted" mb={1}>
              {preview.payload.method} {preview.payload.url || "(no URL yet)"}
            </Text>
            <Text
              as="pre"
              textStyle="xs"
              fontFamily="mono"
              whiteSpace="pre-wrap"
              wordBreak="break-word"
            >
              {formatPreviewBody(preview.payload.body)}
            </Text>
            {preview.errors.length > 0 ? (
              <Text textStyle="xs" color="fg.error" mt={1}>
                {preview.errors[0]} — fix this before the webhook can send.
              </Text>
            ) : null}
          </Box>
        ) : null}
      </VStack>
    </VStack>
  );
}

function formatPreviewBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

const client: NotifyClientDef<WebhookSlice, WebhookPreview> = {
  Icon: Webhook,
  channel: "webhook",
  initialSlice,
  isComplete,
  summary,
  fromTriggerRow,
  toActionParams,
  testFireTarget,
  templatesFromSlice,
  ConfigForm: WebhookConfigForm,
};

export default client;
