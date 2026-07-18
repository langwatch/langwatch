import {
  Box,
  Button,
  Field,
  HStack,
  IconButton,
  Input,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Plus, Trash2, Webhook } from "lucide-react";
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
import { TestFireButton } from "../TestFireButton";
import type {
  ConfigFormCtx,
  ConfigFormProps,
  NotifyClientDef,
  SummaryIdentity,
} from "../types";
import type { SavedTriggerRow } from "~/shared/automations/providers/types";
import {
  isReservedWebhookHeader,
  validateWebhookUrlShape,
  WEBHOOK_HEADER_VALUE_KEPT,
  WEBHOOK_METHODS,
  type WebhookActionParams,
  type WebhookMethod,
  type WebhookPreview,
} from "~/shared/automations/providers/webhook";

/** A template field, mirroring the Slack provider's `FieldDraft`: empty +
 *  `usingDefault` means the framework default envelope applies. */
interface FieldDraft {
  value: string;
  usingDefault: boolean;
}

interface HeaderRow {
  /** Stable client-side identity for React keys — rows are added/removed. */
  id: string;
  name: string;
  value: string;
  /** True when the value is a saved secret the server kept back (ADR-040 §3):
   *  the input shows a masked placeholder, and the save sends the kept
   *  sentinel so the stored value survives. Typing or renaming clears it. */
  kept: boolean;
}

let headerRowSeq = 0;
function newHeaderRow(partial?: Partial<Omit<HeaderRow, "id">>): HeaderRow {
  headerRowSeq += 1;
  return {
    id: `hdr_${headerRowSeq}`,
    name: "",
    value: "",
    kept: false,
    ...partial,
  };
}

export interface WebhookSlice {
  url: string;
  method: WebhookMethod;
  headers: HeaderRow[];
  template: FieldDraft;
}

const EMPTY_FIELD: FieldDraft = { value: "", usingDefault: true };

function initialSlice(): WebhookSlice {
  return { url: "", method: "POST", headers: [], template: EMPTY_FIELD };
}

function isComplete(slice: WebhookSlice): boolean {
  return validateWebhookUrlShape(slice.url.trim()) === null;
}

function summary(slice: WebhookSlice, identity: SummaryIdentity): string {
  const name = identity.name || "(unnamed)";
  const host = (() => {
    try {
      return new URL(slice.url).hostname;
    } catch {
      return null;
    }
  })();
  return `${name} → ${slice.method} ${host ?? "(URL not set)"}`;
}

function fromTriggerRow(row: SavedTriggerRow): WebhookSlice {
  const params = (row.actionParams ?? {}) as Partial<WebhookActionParams>;
  // Saved header VALUES never reach the client (ADR-040 §3) — the server
  // echoes names with the kept sentinel, which renders as a masked row.
  const headers = Object.entries(params.headers ?? {}).map(([name, value]) =>
    value === WEBHOOK_HEADER_VALUE_KEPT
      ? newHeaderRow({ name, kept: true })
      : newHeaderRow({ name, value }),
  );
  return {
    url: typeof params.url === "string" ? params.url : "",
    method: WEBHOOK_METHODS.includes(params.method as WebhookMethod)
      ? (params.method as WebhookMethod)
      : "POST",
    headers,
    template: {
      value: params.bodyTemplate ?? "",
      usingDefault: params.bodyTemplate == null,
    },
  };
}

function headersRecord(rows: HeaderRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) continue;
    // A kept row sends the sentinel; the server resolves it against the
    // stored ciphertext (save) or drops it if unresolvable (test fire).
    out[name] = row.kept ? WEBHOOK_HEADER_VALUE_KEPT : row.value;
  }
  return out;
}

function bodyTemplateOf(slice: WebhookSlice): string | null {
  return slice.template.value.trim().length > 0 ? slice.template.value : null;
}

function toActionParams(slice: WebhookSlice): WebhookActionParams {
  return {
    url: slice.url.trim(),
    method: slice.method,
    headers: headersRecord(slice.headers),
    bodyTemplate: bodyTemplateOf(slice),
  };
}

function testFireTarget(slice: WebhookSlice) {
  return {
    webhook: null,
    webhookDestination: {
      url: slice.url.trim(),
      method: slice.method,
      headers: headersRecord(slice.headers),
      bodyTemplate: bodyTemplateOf(slice),
    },
  };
}

/** The webhook's body lives inside `actionParams` (ADR-040 §1), not in the
 *  four legacy Trigger template columns — so this contributes nothing. */
function templatesFromSlice(_slice: WebhookSlice) {
  return {
    emailSubjectTemplate: null,
    emailBodyTemplate: null,
    slackTemplate: null,
    slackTemplateType: null,
  };
}

/**
 * The most recent webhook test-fire outcome, rendered inline right under the
 * "Send a test" button — the author sees the real HTTP status (or what broke)
 * where they pressed the button, without hunting for a toast.
 */
function LastTestResult({
  attempt,
}: {
  attempt: ConfigFormCtx["lastTestAttempt"];
}) {
  const last = attempt?.channel === "webhook" ? attempt : null;
  if (!last) return null;

  if (last.status === "success") {
    return (
      <Text textStyle="xs" color="fg.success" data-testid="webhook-test-result">
        Delivered{last.httpStatus ? ` — HTTP ${last.httpStatus}` : ""}.
      </Text>
    );
  }
  return (
    <VStack align="start" gap={0} data-testid="webhook-test-result">
      <Text textStyle="xs" color="fg.error" fontWeight="medium">
        {last.errorTitle ?? "Test request failed"}
      </Text>
      {last.errorDetail ? (
        <Text textStyle="xs" color="fg.error">
          {last.errorDetail}
        </Text>
      ) : null}
    </VStack>
  );
}

function HeadersEditor({
  slice,
  onChange,
}: {
  slice: WebhookSlice;
  onChange: (next: WebhookSlice) => void;
}) {
  const setRow = (index: number, row: HeaderRow) => {
    const headers = slice.headers.map((h, i) => (i === index ? row : h));
    onChange({ ...slice, headers });
  };
  const removeRow = (index: number) =>
    onChange({ ...slice, headers: slice.headers.filter((_, i) => i !== index) });

  return (
    <Field.Root>
      <Field.Label>Headers</Field.Label>
      <VStack align="stretch" gap={2} width="full">
        {slice.headers.map((row, index) => {
          const reserved =
            row.name.trim() !== "" && isReservedWebhookHeader(row.name);
          return (
            <VStack key={row.id} align="stretch" gap={1}>
              <HStack gap={2}>
                <Input
                  size="sm"
                  flex="1"
                  value={row.name}
                  placeholder="Authorization"
                  onChange={(e) =>
                    // The saved value is keyed by the old name server-side, so
                    // renaming a kept row means re-entering its value.
                    setRow(index, {
                      ...row,
                      name: e.target.value,
                      kept: false,
                    })
                  }
                />
                <Input
                  size="sm"
                  flex="2"
                  value={row.value}
                  placeholder={row.kept ? "•••••• (saved)" : "Bearer …"}
                  onChange={(e) =>
                    setRow(index, {
                      ...row,
                      value: e.target.value,
                      kept: false,
                    })
                  }
                />
                <IconButton
                  size="sm"
                  variant="ghost"
                  aria-label="Remove header"
                  onClick={() => removeRow(index)}
                >
                  <Trash2 size={14} />
                </IconButton>
              </HStack>
              {reserved ? (
                <Text textStyle="xs" color="fg.error">
                  This header is set by LangWatch and will be ignored.
                </Text>
              ) : null}
            </VStack>
          );
        })}
        <Button
          size="xs"
          variant="outline"
          width="fit-content"
          onClick={() =>
            onChange({
              ...slice,
              headers: [...slice.headers, newHeaderRow()],
            })
          }
        >
          <Plus size={13} /> Add header
        </Button>
      </VStack>
      <Field.HelperText>
        Sent with every request — for example an Authorization header your
        endpoint expects. Values are stored encrypted and never shown again.
      </Field.HelperText>
    </Field.Root>
  );
}

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
                {preview.errors[0]} — the default body will be sent instead.
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
