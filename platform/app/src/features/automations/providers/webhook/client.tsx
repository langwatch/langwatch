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
import type { SavedTriggerRow } from "@langwatch/automations/providers/types";
import {
  DEFAULT_WEBHOOK_CONTENT_TYPE,
  isJsonWebhookContentType,
  isReservedWebhookHeader,
  validateWebhookContentType,
  validateWebhookUrlShape,
  WEBHOOK_HEADER_VALUE_KEPT,
  WEBHOOK_METHODS,
  type WebhookActionParams,
  type WebhookMethod,
  type WebhookPreview,
} from "@langwatch/automations/providers/webhook";
import { defaultsForSourceKind } from "@langwatch/automations/templating/defaults";
import { filterVariablesForCadence } from "@langwatch/automations/templating/exampleContext";
import { Plus, Trash2, Webhook } from "lucide-react";
import { useMemo } from "react";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { VariableInfoIcon } from "~/features/automations/components/VariableInfoIcon";
import {
  LIQUID_JSON_LANGUAGE_ID,
  LIQUID_LANGUAGE_ID,
} from "~/features/automations/editors/liquidMonaco";
import {
  FieldHeader,
  LiquidEditor,
} from "~/features/automations/editors/templateAuthoring";
import { TestFireButton } from "../TestFireButton";
import type {
  ConfigFormCtx,
  ConfigFormProps,
  NotifyClientDef,
  SummaryIdentity,
} from "../types";
import { HighlightedBodyPreview } from "./HighlightedBodyPreview";

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

/** A single stored secret, following the header rows' discipline (ADR-040 §3):
 *  `kept` means the server held the saved value back, so the input stays empty
 *  behind a masked placeholder and the save echoes the kept sentinel. */
interface SecretDraft {
  value: string;
  kept: boolean;
}

export interface WebhookSlice {
  url: string;
  method: WebhookMethod;
  headers: HeaderRow[];
  signingSecret: SecretDraft;
  template: FieldDraft;
  /** The Content-Type the delivery announces. A JSON type gets the checked,
   *  re-serialized treatment with the framework default envelope; any other
   *  type is sent exactly as it renders. Shown as a fixed first row of the
   *  headers editor — it is a header, just not a secret one. */
  contentType: string;
}

const EMPTY_FIELD: FieldDraft = { value: "", usingDefault: true };
const EMPTY_SECRET: SecretDraft = { value: "", kept: false };

function initialSlice(): WebhookSlice {
  return {
    url: "",
    method: "POST",
    headers: [],
    signingSecret: EMPTY_SECRET,
    template: EMPTY_FIELD,
    contentType: DEFAULT_WEBHOOK_CONTENT_TYPE,
  };
}

function isComplete(slice: WebhookSlice): boolean {
  return (
    validateWebhookUrlShape(slice.url.trim()) === null &&
    // Blank means the default, exactly as `toActionParams` and the test-fire
    // target read it — a cleared field must not block a save the send would
    // treat as JSON.
    validateWebhookContentType(
      slice.contentType.trim() || DEFAULT_WEBHOOK_CONTENT_TYPE,
    ) === null
  );
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
    signingSecret:
      params.signingSecret === WEBHOOK_HEADER_VALUE_KEPT
        ? { value: "", kept: true }
        : { value: params.signingSecret ?? "", kept: false },
    template: {
      value: params.bodyTemplate ?? "",
      usingDefault: params.bodyTemplate == null,
    },
    contentType:
      typeof params.contentType === "string" && params.contentType.trim() !== ""
        ? params.contentType
        : DEFAULT_WEBHOOK_CONTENT_TYPE,
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

/** The sentinel for an untouched saved secret, the typed value for a new one,
 *  and null for an empty field, which turns signing off. */
function signingSecretOf(slice: WebhookSlice): string | null {
  if (slice.signingSecret.kept) return WEBHOOK_HEADER_VALUE_KEPT;
  const typed = slice.signingSecret.value.trim();
  return typed.length > 0 ? typed : null;
}

function toActionParams(slice: WebhookSlice): WebhookActionParams {
  return {
    url: slice.url.trim(),
    method: slice.method,
    headers: headersRecord(slice.headers),
    bodyTemplate: bodyTemplateOf(slice),
    contentType: slice.contentType.trim() || DEFAULT_WEBHOOK_CONTENT_TYPE,
    signingSecret: signingSecretOf(slice),
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
      contentType: slice.contentType.trim() || DEFAULT_WEBHOOK_CONTENT_TYPE,
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

/** Content-Type is a header like any other to the receiver, but not to the
 *  editor: custom header values are secrets (encrypted, never echoed back),
 *  while the declared type must round-trip — and it also decides how the body
 *  is treated and highlighted. So it gets a fixed, always-present first row
 *  instead of a removable secret one. */
function ContentTypeRow({
  slice,
  onChange,
}: {
  slice: WebhookSlice;
  onChange: (next: WebhookSlice) => void;
}) {
  const problem = validateWebhookContentType(slice.contentType);
  return (
    <>
      <HStack gap={2}>
        <Input size="sm" flex="1" value="Content-Type" readOnly disabled />
        <Input
          size="sm"
          flex="2"
          data-testid="webhook-content-type"
          aria-label="Content-Type value"
          value={slice.contentType}
          placeholder={DEFAULT_WEBHOOK_CONTENT_TYPE}
          onChange={(e) => onChange({ ...slice, contentType: e.target.value })}
        />
        {/* Spacer keeping the value column aligned with the removable rows. */}
        <Box width="8" flexShrink={0} />
      </HStack>
      {problem ? <Field.ErrorText>{problem}</Field.ErrorText> : null}
    </>
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
    onChange({
      ...slice,
      headers: slice.headers.filter((_, i) => i !== index),
    });

  return (
    <Field.Root
      invalid={validateWebhookContentType(slice.contentType) !== null}
    >
      <Field.Label>Headers</Field.Label>
      <VStack align="stretch" gap={2} width="full">
        <ContentTypeRow slice={slice} onChange={onChange} />
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
        Sent with every request. Content-Type also decides how the body is
        treated: application/json is checked before it sends, anything else is
        sent exactly as you write it. Other header values — for example an
        Authorization header — are stored encrypted and never shown again.
      </Field.HelperText>
    </Field.Root>
  );
}

function SigningSecretField({
  slice,
  onChange,
}: {
  slice: WebhookSlice;
  onChange: (next: WebhookSlice) => void;
}) {
  const { value, kept } = slice.signingSecret;
  return (
    <Field.Root>
      <Field.Label>Signing secret (optional)</Field.Label>
      <HStack gap={2} width="full">
        <Input
          data-testid="webhook-signing-secret"
          type="password"
          autoComplete="off"
          flex="1"
          value={value}
          placeholder={kept ? "•••••• (saved)" : "A secret your endpoint holds"}
          onChange={(e) =>
            onChange({
              ...slice,
              signingSecret: { value: e.target.value, kept: false },
            })
          }
        />
        {/* A saved secret leaves the input empty, so turning signing off needs
            its own control. A typed one clears by emptying the input. */}
        {kept ? (
          <IconButton
            size="sm"
            variant="ghost"
            aria-label="Remove signing secret"
            onClick={() => onChange({ ...slice, signingSecret: EMPTY_SECRET })}
          >
            <Trash2 size={14} />
          </IconButton>
        ) : null}
      </HStack>
      <Field.HelperText>
        When set, deliveries carry an X-LangWatch-Signature header the receiver
        can verify. Leave it empty to send unsigned deliveries.
      </Field.HelperText>
    </Field.Root>
  );
}

const METHOD_ITEMS = WEBHOOK_METHODS.map((m) => ({ value: m, label: m }));

/**
 * The body the endpoint receives: the Liquid template that renders it and a
 * preview of what the next fire would post. The editor's language and the
 * preview's highlighting both follow the declared Content-Type — change it in
 * the headers and this surface adapts.
 *
 * A JSON content type keeps the framework default and its reset affordance;
 * any other has neither — there is no envelope to guess at for an endpoint
 * that asked for something else, so an empty non-JSON body sends nothing.
 */
function BodyEditor({
  slice,
  onChange,
  ctx,
}: ConfigFormProps<WebhookSlice, WebhookPreview>) {
  const isJson = isJsonWebhookContentType(slice.contentType);
  const defaults = defaultsForSourceKind(ctx.sourceKind);
  const templateValue = isJson
    ? slice.template.value || defaults.webhookBody
    : slice.template.value;
  const variables = useMemo(
    () => filterVariablesForCadence(ctx.variables, ctx.cadenceMode),
    [ctx.variables, ctx.cadenceMode],
  );
  const preview = ctx.preview;

  return (
    <VStack align="stretch" gap={2}>
      {isJson ? (
        <FieldHeader
          label="Body"
          usingDefault={slice.template.usingDefault}
          onReset={() => onChange({ ...slice, template: EMPTY_FIELD })}
          trailing={<VariableInfoIcon variables={variables} />}
        />
      ) : (
        <HStack gap={2}>
          <Text textStyle="sm" fontWeight="semibold">
            Body
          </Text>
          <VariableInfoIcon variables={variables} />
        </HStack>
      )}
      <Text textStyle="xs" color="fg.muted">
        Write the body your endpoint receives. Values in braces fill in from
        your trace or metric when the request sends.
      </Text>
      <Box data-testid="webhook-body-editor">
        <LiquidEditor
          variables={variables}
          height="280px"
          language={isJson ? LIQUID_JSON_LANGUAGE_ID : LIQUID_LANGUAGE_ID}
          value={templateValue}
          onChange={(value) =>
            onChange({ ...slice, template: { value, usingDefault: false } })
          }
        />
      </Box>
      {preview ? (
        <BodyPreview preview={preview} contentType={slice.contentType} />
      ) : null}
    </VStack>
  );
}

/** What the next fire would post, shown under the editor, highlighted for the
 *  declared Content-Type when we have a grammar for it. */
function BodyPreview({
  preview,
  contentType,
}: {
  preview: WebhookPreview;
  contentType: string;
}) {
  const isJson = isJsonWebhookContentType(contentType);
  return (
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
      <HighlightedBodyPreview
        body={
          isJson
            ? formatPreviewBody(preview.payload.body)
            : preview.payload.body
        }
        contentType={contentType}
      />
      {preview.errors.length > 0 ? (
        <Text textStyle="xs" color="fg.error" mt={1}>
          {preview.errors[0]}
          {isJson
            ? " — the default body will be sent instead."
            : " — an empty body will be sent instead."}
        </Text>
      ) : null}
    </Box>
  );
}

function WebhookConfigForm({
  slice,
  onChange,
  ctx,
}: ConfigFormProps<WebhookSlice, WebhookPreview>) {
  const urlProblem =
    slice.url.trim() === "" ? null : validateWebhookUrlShape(slice.url.trim());
  const complete = isComplete(slice);

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
          <Field.HelperText>An https endpoint you control.</Field.HelperText>
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
      <SigningSecretField slice={slice} onChange={onChange} />
      {/* Try the real request straight from the destination section; the
          outcome (status code / failure) lands right below the button. */}
      <VStack align="start" gap={2}>
        <TestFireButton
          onTestFire={ctx.onTestFire}
          loading={ctx.testFireLoading}
          disabled={!complete}
          hint={
            complete
              ? undefined
              : validateWebhookUrlShape(slice.url.trim()) !== null
                ? "Add a valid https URL first"
                : "Fix the Content-Type header first"
          }
        />
        <LastTestResult attempt={ctx.lastTestAttempt} />
      </VStack>
      <BodyEditor slice={slice} onChange={onChange} ctx={ctx} />
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
