import {
  Box,
  Button,
  Code,
  createListCollection,
  Field,
  HStack,
  Input,
  List,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ExternalLink } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FaSlack } from "react-icons/fa";
import { Link } from "~/components/ui/link";
import { SegmentedControl } from "~/components/ui/segmented-control";
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
import {
  SLACK_BOT_TOKEN_KEPT,
  slackDeliveryMethodOf,
  type SlackActionParams,
  type SlackDeliveryMethod,
  type SlackPreview,
  type SlackTemplateType,
} from "./shared";
import { findTemplateOptionBySource } from "./templates/registry";
import { SlackBlockKitTemplatePicker } from "./templates/TemplatePicker";

interface FieldDraft {
  value: string;
  usingDefault: boolean;
}

export interface SlackSlice {
  /** How the message reaches Slack: a legacy incoming webhook, or a Slack app
   *  bot token posting via the Web API. Drives which destination fields and
   *  which templates are offered. */
  deliveryMethod: SlackDeliveryMethod;
  /** Webhook destination (used when `deliveryMethod` is "webhook"). */
  webhook: string;
  /** A newly typed bot token. Empty means "unchanged": on an edit the server
   *  keeps the stored token; on a fresh draft an empty token is incomplete.
   *  The stored token is never read back into the form (see `botTokenAlreadySet`). */
  botToken: string;
  /** Bot destination channel (id like C0123, or #name). */
  channelId: string;
  /** True when the row already has a stored bot token (echoed by the server as
   *  a flag, never the token itself), so the form can show "token set" and let
   *  the author keep it without retyping. */
  botTokenAlreadySet: boolean;
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
  return {
    deliveryMethod: "webhook",
    webhook: "",
    botToken: "",
    channelId: "",
    botTokenAlreadySet: false,
    templateType: "block_kit",
    template: EMPTY_FIELD,
  };
}

function isComplete(slice: SlackSlice): boolean {
  if (slice.deliveryMethod === "bot") {
    return (
      slice.channelId.trim().length > 0 &&
      (slice.botToken.trim().length > 0 || slice.botTokenAlreadySet)
    );
  }
  return slice.webhook.trim().length > 0;
}

function summary(slice: SlackSlice, identity: SummaryIdentity): string {
  const name = identity.name || "(unnamed)";
  if (slice.deliveryMethod === "bot") {
    const channel = slice.channelId.trim();
    return `${name} → Slack app${channel ? ` ${channel}` : " (channel not set)"}`;
  }
  return `${name} → Slack webhook${slice.webhook ? " set" : " (not set)"}`;
}

function fromTriggerRow(row: SavedTriggerRow): SlackSlice {
  const params = (row.actionParams ?? {}) as Partial<SlackActionParams>;
  return {
    deliveryMethod: slackDeliveryMethodOf(params),
    webhook: typeof params.slackWebhook === "string" ? params.slackWebhook : "",
    // The token is never sent to the browser — start blank and rely on
    // `botTokenAlreadySet` to keep the stored one.
    botToken: "",
    channelId:
      typeof params.slackChannelId === "string" ? params.slackChannelId : "",
    botTokenAlreadySet: params.slackBotTokenSet === true,
    templateType:
      row.slackTemplateType === "block_kit" ? "block_kit" : "string",
    template: {
      value: row.slackTemplate ?? "",
      usingDefault: row.slackTemplate == null,
    },
  };
}

function toActionParams(slice: SlackSlice): SlackActionParams {
  if (slice.deliveryMethod === "bot") {
    const typed = slice.botToken.trim();
    // A typed token is sent as-is. A blank field on a row that already has a
    // stored token sends the sentinel so the server keeps it; a blank field on
    // a fresh draft sends blank (the server rejects it with a clear error).
    const slackBotToken =
      typed.length > 0
        ? typed
        : slice.botTokenAlreadySet
          ? SLACK_BOT_TOKEN_KEPT
          : "";
    return {
      slackDelivery: "bot",
      slackChannelId: slice.channelId,
      slackBotToken,
    };
  }
  return { slackDelivery: "webhook", slackWebhook: slice.webhook };
}

function testFireTarget(slice: SlackSlice) {
  // Bot mode test-fires via the Web API: hand the channel + the freshly-typed
  // token (null when kept — the server loads the saved one by automation id).
  if (slice.deliveryMethod === "bot") {
    return {
      webhook: null,
      botDestination: {
        channelId: slice.channelId,
        botToken: slice.botToken.trim() || null,
      },
    };
  }
  return { webhook: slice.webhook || null, botDestination: null };
}

const DELIVERY_ITEMS: { value: SlackDeliveryMethod; label: string }[] = [
  { value: "webhook", label: "Incoming webhook" },
  { value: "bot", label: "Slack app (bot)" },
];

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
      {/* Destination first: choose how the message reaches Slack, then fill in
          the fields for that method. Switching only flips `deliveryMethod`, so
          the other method's fields survive a round-trip. */}
      <Field.Root>
        <Field.Label>Connection</Field.Label>
        <SegmentedControl
          size="sm"
          value={slice.deliveryMethod}
          onValueChange={({ value }) => {
            if (value)
              onChange({
                ...slice,
                deliveryMethod: value as SlackDeliveryMethod,
              });
          }}
          items={DELIVERY_ITEMS}
        />
        <Field.HelperText>
          {slice.deliveryMethod === "webhook"
            ? "Quick to set up, but limited formatting. Switch to a Slack app for charts, tables, and alert banners."
            : "Recommended — renders charts, tables, and alert banners. A quick one-time setup, below."}
        </Field.HelperText>
      </Field.Root>
      {slice.deliveryMethod === "bot" ? (
        <SlackBotFields slice={slice} onChange={onChange} />
      ) : (
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
      )}
      {/* Alerts always deliver immediately (cadence is pinned server-side),
          so the cadence switch only renders for trace automations. */}
      {!isGraphAlert ? (
        <InlineCadenceSelect
          value={ctx.notificationCadence}
          onChange={ctx.setNotificationCadence}
        />
      ) : null}
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
            deliveryMethod={slice.deliveryMethod}
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
 * Bot-connection destination: the channel to post in plus the app's bot token.
 * The token is write-only from the browser's side — once stored, the server
 * echoes a "set" flag (`botTokenAlreadySet`) instead of the secret, so the
 * field stays blank and the author keeps the stored token unless they type a
 * new one. A short setup callout points at where to create the Slack app.
 */
function SlackBotFields({
  slice,
  onChange,
}: {
  slice: SlackSlice;
  onChange: (next: SlackSlice) => void;
}) {
  const tokenRef = useRef<HTMLInputElement>(null);
  const [stepsOpen, setStepsOpen] = useState(false);
  const tokenKept = slice.botTokenAlreadySet && slice.botToken.length === 0;

  return (
    <VStack align="stretch" gap={3}>
      <Field.Root>
        <Field.Label>Channel</Field.Label>
        <Input
          value={slice.channelId}
          onChange={(e) => onChange({ ...slice, channelId: e.target.value })}
          placeholder="#alerts or C0123…"
        />
      </Field.Root>
      <Field.Root>
        <Field.Label>Bot User OAuth Token</Field.Label>
        <Input
          ref={tokenRef}
          type="password"
          autoComplete="off"
          value={slice.botToken}
          onChange={(e) => onChange({ ...slice, botToken: e.target.value })}
          placeholder={
            slice.botTokenAlreadySet
              ? "•••••••• (unchanged, leave blank to keep)"
              : "xoxb-…"
          }
        />
        {tokenKept ? (
          <HStack gap={1} pt={1}>
            <Text textStyle="xs" color="fg.muted">
              A token is already saved.
            </Text>
            <Button
              variant="plain"
              size="xs"
              height="auto"
              paddingX={0}
              color="fg.muted"
              _hover={{ color: "fg" }}
              onClick={() => tokenRef.current?.focus()}
            >
              Replace token
            </Button>
          </HStack>
        ) : null}
      </Field.Root>
      <Box
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="md"
        bg="bg.subtle"
        padding={3}
      >
        <VStack align="stretch" gap={2}>
          <Text textStyle="xs" color="fg">
            A Slack app unlocks the richer messages — charts, tables, and colored
            alert banners — that a webhook can&rsquo;t show.
          </Text>
          <Text textStyle="xs" color="fg.muted">
            It takes about two minutes: create an app, give it one permission,
            and paste the token below. You only do it once.
          </Text>
          <Link
            href="https://api.slack.com/apps"
            isExternal
            textStyle="xs"
            fontWeight="medium"
            display="inline-flex"
            alignItems="center"
            gap={1}
            width="fit-content"
          >
            Create a Slack app <ExternalLink size={12} />
          </Link>
          <TemplateDisclosure
            triggerLabel="Setup steps"
            open={stepsOpen}
            onToggle={() => setStepsOpen((prev) => !prev)}
          >
            <List.Root as="ol" gap={1} paddingLeft={4}>
              <List.Item>
                <Text textStyle="xs" color="fg.muted">
                  Create an app in your workspace.
                </Text>
              </List.Item>
              <List.Item>
                <Text textStyle="xs" color="fg.muted">
                  Add the <Code size="sm">chat:write</Code> bot scope.
                </Text>
              </List.Item>
              <List.Item>
                <Text textStyle="xs" color="fg.muted">
                  Install the app to your workspace.
                </Text>
              </List.Item>
              <List.Item>
                <Text textStyle="xs" color="fg.muted">
                  Copy the Bot User OAuth Token (starts with{" "}
                  <Code size="sm">xoxb-</Code>).
                </Text>
              </List.Item>
              <List.Item>
                <Text textStyle="xs" color="fg.muted">
                  Invite the bot to the channel you post to.
                </Text>
              </List.Item>
            </List.Root>
          </TemplateDisclosure>
        </VStack>
      </Box>
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
