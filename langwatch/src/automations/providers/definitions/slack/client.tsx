import {
  Box,
  Button,
  Code,
  createListCollection,
  Field,
  HStack,
  Input,
  List,
  NativeSelect,
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
  /** True only when editing an automation that was saved with a webhook. New
   *  automations are bot-only (a webhook can't render the modern templates), so
   *  the webhook option is offered ONLY to keep existing webhook automations
   *  editable — they can stay on the webhook or upgrade to a Slack app. */
  isLegacyWebhook: boolean;
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
    // New Slack automations use a bot connection — it renders the modern
    // templates (charts, tables, alerts) that a webhook can't. Webhooks are
    // kept only for editing automations that already have one.
    deliveryMethod: "bot",
    webhook: "",
    botToken: "",
    channelId: "",
    botTokenAlreadySet: false,
    isLegacyWebhook: false,
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
  const deliveryMethod = slackDeliveryMethodOf(params);
  return {
    deliveryMethod,
    // A saved webhook automation stays editable as a webhook (backward compat);
    // this flag unlocks the webhook UI + the upgrade banner for it.
    isLegacyWebhook: deliveryMethod === "webhook",
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

/**
 * Slack app manifest an author pastes into "Create app → From a manifest" to
 * skip manual scope setup. One app serves the whole workspace (not per
 * automation), so the name is generic. It grants `chat:write` (post messages)
 * plus `channels:read`/`groups:read` so the channel picker works out of the box.
 */
const SLACK_APP_MANIFEST = `display_information:
  name: LangWatch
oauth_config:
  scopes:
    bot:
      - chat:write
      - channels:read
      - groups:read`;

/** Shown on a legacy webhook automation: nudges the author to move to a Slack
 *  app, which unlocks the richer templates a webhook can't render. */
function UpgradeToBotBanner({ onUpgrade }: { onUpgrade: () => void }) {
  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      bg="bg.subtle"
      padding={3}
    >
      <HStack justify="space-between" gap={3} align="center">
        <VStack align="start" gap={0}>
          <Text textStyle="xs" fontWeight="medium" color="fg">
            Get charts, tables, and alert banners
          </Text>
          <Text textStyle="xs" color="fg.muted">
            Move this automation to a Slack app to unlock the richer templates.
          </Text>
        </VStack>
        <Button size="xs" variant="outline" flexShrink={0} onClick={onUpgrade}>
          Switch to a Slack app
        </Button>
      </HStack>
    </Box>
  );
}

/**
 * Channel input with an optional "load from Slack" picker. Manual entry always
 * works; if the app has the `channels:read` scope, the author can load the
 * channel list off the typed token and pick from it. A missing scope degrades
 * to a hint, never an error.
 */
function SlackChannelField({
  projectId,
  slice,
  onChange,
}: {
  projectId: string;
  slice: SlackSlice;
  onChange: (next: SlackSlice) => void;
}) {
  const list = api.automation.listSlackChannels.useMutation();
  const canLoad = slice.botToken.trim().length > 0;
  const channels = list.data?.channels ?? [];
  const scopeHint =
    list.data && list.data.error && list.data.error !== "no_token"
      ? list.data.error === "missing_scope"
        ? "Add the channels:read scope to your app to pick from a list — you can still type the channel above."
        : "Couldn't load channels from Slack. Type the channel above."
      : null;

  return (
    <Field.Root>
      <Field.Label>Channel</Field.Label>
      <Input
        value={slice.channelId}
        onChange={(e) => onChange({ ...slice, channelId: e.target.value })}
        placeholder="#alerts or C0123…"
      />
      <HStack gap={2} pt={1}>
        {channels.length > 0 ? (
          <NativeSelect.Root size="sm" width="auto">
            <NativeSelect.Field
              value=""
              onChange={(e) => {
                if (e.target.value)
                  onChange({ ...slice, channelId: e.target.value });
              }}
            >
              <option value="">Pick a channel…</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        ) : (
          <Button
            variant="plain"
            size="xs"
            height="auto"
            paddingX={0}
            color="fg.muted"
            _hover={{ color: "fg" }}
            disabled={!canLoad || list.isPending}
            onClick={() =>
              list.mutate({ projectId, botToken: slice.botToken.trim() })
            }
          >
            {list.isPending ? "Loading…" : "Load channels from Slack"}
          </Button>
        )}
      </HStack>
      {scopeHint ? (
        <Text textStyle="xs" color="fg.muted" pt={1}>
          {scopeHint}
        </Text>
      ) : null}
    </Field.Root>
  );
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
      {/* New Slack automations are bot-only, so no chooser is shown. The
          chooser appears ONLY when editing a saved webhook automation, letting
          it stay on the webhook or upgrade to a Slack app. */}
      {slice.isLegacyWebhook ? (
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
              ? "This automation uses a webhook. Move it to a Slack app for charts, tables, and alert banners."
              : "Renders charts, tables, and alert banners."}
          </Field.HelperText>
        </Field.Root>
      ) : null}
      {slice.deliveryMethod === "bot" ? (
        <SlackBotFields
          slice={slice}
          onChange={onChange}
          projectId={ctx.projectId}
        />
      ) : (
        <VStack align="stretch" gap={3}>
          <UpgradeToBotBanner
            onUpgrade={() => onChange({ ...slice, deliveryMethod: "bot" })}
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
        </VStack>
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
  projectId,
}: {
  slice: SlackSlice;
  onChange: (next: SlackSlice) => void;
  projectId: string;
}) {
  const tokenRef = useRef<HTMLInputElement>(null);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const tokenKept = slice.botTokenAlreadySet && slice.botToken.length === 0;

  const copyManifest = () => {
    void navigator.clipboard?.writeText(SLACK_APP_MANIFEST);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <VStack align="stretch" gap={3}>
      <Box
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="md"
        bg="bg.subtle"
        padding={3}
      >
        <VStack align="stretch" gap={2}>
          <Text textStyle="xs" color="fg">
            Post to your Slack workspace with a bot token. Create a Slack app,
            then paste its token below.
          </Text>
          <HStack gap={3}>
            <Link
              href="https://api.slack.com/apps"
              isExternal
              textStyle="xs"
              fontWeight="medium"
              display="inline-flex"
              alignItems="center"
              gap={1}
            >
              Create a Slack app <ExternalLink size={12} />
            </Link>
            <Button
              variant="plain"
              size="xs"
              height="auto"
              paddingX={0}
              color="fg.muted"
              _hover={{ color: "fg" }}
              onClick={copyManifest}
            >
              {copied ? "Manifest copied" : "Copy app manifest"}
            </Button>
          </HStack>
          <TemplateDisclosure
            triggerLabel="Setup steps"
            open={stepsOpen}
            onToggle={() => setStepsOpen((prev) => !prev)}
          >
            <List.Root as="ol" gap={1} paddingLeft={4}>
              <List.Item>
                <Text textStyle="xs" color="fg.muted">
                  Create the app with &ldquo;From a manifest&rdquo; and paste the
                  copied manifest — it sets the permissions for you.
                </Text>
              </List.Item>
              <List.Item>
                <Text textStyle="xs" color="fg.muted">
                  Install it to your workspace and copy the Bot User OAuth Token
                  (<Code size="sm">xoxb-</Code>).
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
      <SlackChannelField
        projectId={projectId}
        slice={slice}
        onChange={onChange}
      />
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
