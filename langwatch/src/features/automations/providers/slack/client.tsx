import {
  Box,
  Button,
  Code,
  Combobox,
  createListCollection,
  Field,
  HStack,
  Input,
  List,
  Portal,
  Spinner,
  Text,
  useFilter,
  useListCollection,
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
import { defaultsForSourceKind } from "@langwatch/automations/templating/defaults";
import { filterVariablesForCadence } from "@langwatch/automations/templating/exampleContext";
import { api } from "~/utils/api";
import { TestFireButton } from "../TestFireButton";
import type {
  ConfigFormProps,
  NotifyClientDef,
  SummaryIdentity,
} from "../types";
import type { SavedTriggerRow } from "@langwatch/automations/providers/types";
import {
  SLACK_BOT_TOKEN_KEPT,
  slackDeliveryMethodOf,
  type SlackActionParams,
  type SlackDeliveryMethod,
  type SlackPreview,
  type SlackTemplateType,
} from "@langwatch/automations/providers/slack";
import {
  findTemplateOptionBySource,
  pickDefaultSlackBlockKitTemplateId,
  reportSourceIsAutoLayout,
  SLACK_BLOCK_KIT_TEMPLATES,
} from "./templates/registry";
import { SlackBlockKitTemplatePicker } from "./templates/TemplatePicker";

/** A template field. `usingDefault` means "the author has not customised this"
 *  — it is what the Reset affordance and the default badge read. `value` is the
 *  template that will actually be sent: empty while the framework default
 *  applies, and pre-filled for a report (whose layout follows its content
 *  source, so the draft carries the matching layout from the start). */
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
 * automation), so the name is generic. It grants:
 *   - `chat:write` — post messages to channels the bot is a member of
 *   - `chat:write.public` — post to ANY public channel without being invited
 *     first; without it Slack rejects the post with `not_in_channel` until the
 *     bot is manually `/invite`d, which is the #1 setup snag
 *   - `channels:read` / `groups:read` — populate the channel picker
 */
const SLACK_APP_MANIFEST = `display_information:
  name: LangWatch
oauth_config:
  scopes:
    bot:
      - chat:write
      - chat:write.public
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
 * Channel field: a typeable combobox. Manual entry always works (type a name or
 * paste an ID); once a token is present the channel list is fetched
 * AUTOMATICALLY and drops in as filterable suggestions. Picking a suggestion
 * stores the channel ID (what `chat.postMessage` wants), while free typing is
 * kept verbatim so a custom / not-yet-listed channel still works. A missing
 * scope degrades to a hint, never a hard error.
 */
function SlackChannelField({
  projectId,
  automationId,
  slice,
  onChange,
}: {
  projectId: string;
  automationId?: string;
  slice: SlackSlice;
  onChange: (next: SlackSlice) => void;
}) {
  const list = api.automation.listSlackChannels.useMutation();
  const typedToken = slice.botToken.trim();
  // Read the STABLE reference react-query hands back — `?? []` would mint a fresh
  // array every render and turn the "sync the collection" effect below into an
  // infinite render loop.
  const channelData = list.data?.channels;
  const channels = channelData ?? [];

  const fetchChannels = (key: string) => {
    lastFetched.current = key;
    list.mutate(
      { projectId, botToken: typedToken || null, automationId },
      {
        onError: (error) =>
          // eslint-disable-next-line no-console
          console.error("[slack] listSlackChannels failed", error),
      },
    );
  };

  // Fetch as soon as a usable token exists — a freshly typed one (debounced so
  // we don't fire mid-type) or the stored token of a saved automation (loaded
  // server-side by id). No button to click; the list just appears.
  const fetchKey = typedToken
    ? /^xoxb-/.test(typedToken)
      ? `typed:${typedToken}`
      : null
    : slice.botTokenAlreadySet || automationId
      ? "stored"
      : null;
  const lastFetched = useRef<string | null>(null);
  useEffect(() => {
    if (!fetchKey || lastFetched.current === fetchKey) return;
    const delay = fetchKey.startsWith("typed:") ? 600 : 0;
    const timer = setTimeout(() => fetchChannels(fetchKey), delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey]);

  // Filterable collection, refreshed whenever a fetch lands.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { contains } = useFilter({ sensitivity: "base" });
  const { collection, filter, set } = useListCollection<{
    label: string;
    value: string;
  }>({ initialItems: [], filter: contains });
  useEffect(() => {
    set(
      (channelData ?? []).map((c) => ({
        value: c.id,
        label: `${c.isPrivate ? "🔒 " : "#"}${c.name}`,
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelData]);

  const canLoad =
    typedToken.length > 0 || slice.botTokenAlreadySet || !!automationId;
  const returnedError =
    list.data?.error && list.data.error !== "no_token"
      ? list.data.error
      : null;
  const hint = list.isError
    ? `Couldn't load channels: ${list.error?.message ?? "request failed"}. You can still type the channel above.`
    : returnedError === "missing_scope"
      ? "Add the channels:read scope to your app and reinstall it to pick from a list — you can still type the channel above."
      : returnedError
        ? "Couldn't load channels from Slack. Check the token, or type the channel above."
        : null;

  return (
    <Field.Root>
      <HStack justify="space-between" align="center" width="full">
        <Field.Label>Channel</Field.Label>
        {canLoad ? (
          <Button
            variant="plain"
            size="xs"
            height="auto"
            paddingX={0}
            color="fg.muted"
            _hover={{ color: "fg" }}
            disabled={list.isPending}
            onClick={() => fetchChannels(fetchKey ?? `manual:${Date.now()}`)}
          >
            {list.isPending ? "Loading…" : "Reload"}
          </Button>
        ) : null}
      </HStack>
      <Combobox.Root
        collection={collection}
        size="sm"
        width="full"
        allowCustomValue
        openOnClick
        value={slice.channelId ? [slice.channelId] : []}
        onValueChange={(details) =>
          onChange({ ...slice, channelId: details.value[0] ?? "" })
        }
        onInputValueChange={(details) => {
          filter(details.inputValue);
          // Immediate free entry (paste an ID / type a name). A real pick is
          // handled by onValueChange so we keep the channel ID, not its label.
          if (details.reason === "input-change") {
            onChange({ ...slice, channelId: details.inputValue });
          }
        }}
        onOpenChange={(details) => {
          if (details.open) filter("");
        }}
      >
        <Combobox.Control>
          <Combobox.Input
            placeholder={
              list.isPending ? "Loading channels…" : "#alerts or C0123…"
            }
          />
          <Combobox.IndicatorGroup>
            {list.isPending ? <Spinner size="xs" /> : null}
            <Combobox.Trigger />
          </Combobox.IndicatorGroup>
        </Combobox.Control>
        <Portal>
          <Combobox.Positioner zIndex="max">
            <Combobox.Content>
              <Combobox.Empty>
                {list.isPending
                  ? "Loading channels…"
                  : channels.length === 0
                    ? "Type a channel name or ID"
                    : "No match — press Enter to use what you typed"}
              </Combobox.Empty>
              {collection.items.map((item) => (
                <Combobox.Item item={item} key={item.value}>
                  <Combobox.ItemText>{item.label}</Combobox.ItemText>
                  <Combobox.ItemIndicator />
                </Combobox.Item>
              ))}
            </Combobox.Content>
          </Combobox.Positioner>
        </Portal>
      </Combobox.Root>
      {hint ? (
        <Text
          textStyle="xs"
          color={list.isError ? "fg.error" : "fg.muted"}
          pt={1}
        >
          {hint}
        </Text>
      ) : null}
    </Field.Root>
  );
}

function templatesFromSlice(slice: SlackSlice) {
  return {
    emailSubjectTemplate: null,
    emailBodyTemplate: null,
    // The template the author is looking at is the template we store — whether
    // they wrote it, picked it from the gallery, or it was seeded from the
    // report's content source. An empty field means no template of our own, so
    // the framework default applies.
    slackTemplate:
      slice.template.value.trim().length > 0 ? slice.template.value : null,
    // Always carry the toggle. A null `slackTemplate` paired with a
    // non-null `slackTemplateType` means "use the framework default for
    // this type" — without this the server can't tell apart a user who
    // wants the block_kit default from a user who wants the plain-text
    // default, and falls back to text either way.
    slackTemplateType: slice.templateType,
  };
}

/**
 * The preview must render under the SAME rules delivery will. A webhook strips
 * the modern blocks (chart / table / alert banner) and the message degrades to
 * its fallback; a bot connection renders them. Previewing a chart the webhook
 * is about to strip — or hiding one the bot will happily send — is the fastest
 * way to make the editor feel like it is lying.
 */
function previewOptions(slice: SlackSlice) {
  return { allowGatedBlocks: slice.deliveryMethod === "bot" };
}

function SlackConfigForm({
  slice,
  onChange,
  ctx,
}: ConfigFormProps<SlackSlice, SlackPreview>) {
  const isBlockKit = slice.templateType === "block_kit";
  const isReport = ctx.sourceKind === "report";
  // A dashboard report maps straight onto its panels — no layout to pick.
  const autoLayout = isReport && reportSourceIsAutoLayout(ctx.reportSourceKind);
  // The editor must seed the same default dispatch renders for this kind —
  // otherwise the shown template and the sent message disagree.
  const defaults = defaultsForSourceKind(ctx.sourceKind);
  const templateDefault = isBlockKit
    ? defaults.slackBlockKit
    : defaults.slackString;
  // A report draft carries its layout from the start (see the seeding effect
  // below) while still counting as un-customised, so a filled field always wins
  // over the framework default.
  const templateValue = slice.template.value || templateDefault;
  const slackPreview = ctx.preview;
  const variables = useMemo(
    () => filterVariablesForCadence(ctx.variables, ctx.cadenceMode),
    [ctx.variables, ctx.cadenceMode],
  );

  // A returning author who hand-edited the Block Kit source (not a preset,
  // not the framework default) lands on the Code tab so their custom layout
  // is visible; everyone else starts on the Template gallery.
  const isCustomBlockKit =
    isBlockKit &&
    !slice.template.usingDefault &&
    !findTemplateOptionBySource(slice.template.value);
  const [messageMode, setMessageMode] = useState<"template" | "code">(
    isCustomBlockKit ? "code" : "template",
  );

  // If the cadence or trigger kind switches away from what the picked
  // preset was built for (immediate template on a digest dispatch, trace
  // template on a graph alert, or vice versa), the source would render
  // empty/first-match-only bodies. Reset to the framework default so the
  // editor shows a template that fits the new draft.
  //
  // A report's CONTENT source counts the same way: a chart layout has no series
  // to plot once the report switches to matching traces, and a table of traces
  // has no rows once it switches to a graph.
  //
  // Only a BUNDLED layout is reset this way — whether the author picked it or a
  // report seeded it. A template the author wrote themselves is never one of
  // ours, so it is never thrown away from under them.
  useEffect(() => {
    const preset = findTemplateOptionBySource(slice.template.value);
    if (!preset) return;
    const cadenceMismatch =
      preset.cadenceFit !== "both" && preset.cadenceFit !== ctx.cadenceMode;
    const kindMismatch = preset.kind !== ctx.sourceKind;
    const reportSourceMismatch =
      preset.kind === "report" &&
      ctx.reportSourceKind !== undefined &&
      !(preset.reportSources ?? []).includes(ctx.reportSourceKind);
    if (!cadenceMismatch && !kindMismatch && !reportSourceMismatch) return;
    onChange({ ...slice, template: EMPTY_FIELD });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.cadenceMode, ctx.sourceKind, ctx.reportSourceKind]);

  // A report's layout FOLLOWS its content source — a dashboard has no layout
  // decision to make at all. So rather than leaving the template column null
  // and relying on a framework default that can't know the source, seed the
  // matching layout concretely. What the author sees here is then exactly what
  // is stored and sent.
  //
  // The draft stays on `usingDefault: true` while it holds the seeded layout:
  // the author has customised nothing yet, so the field must still read as the
  // default and Reset must bring the bundled layout back rather than being a
  // no-op on a draft that only LOOKS hand-written.
  useEffect(() => {
    if (!isReport || !isBlockKit || !slice.template.usingDefault) return;
    const id = pickDefaultSlackBlockKitTemplateId({
      cadence: ctx.cadenceMode,
      hasEvaluationFilter: ctx.hasEvaluationFilter,
      kind: "report",
      reportSource: ctx.reportSourceKind,
    });
    const option = SLACK_BLOCK_KIT_TEMPLATES.find((opt) => opt.id === id);
    if (!option || slice.template.value === option.source) return;
    onChange({
      ...slice,
      template: { value: option.source, usingDefault: true },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isReport,
    isBlockKit,
    slice.template.usingDefault,
    ctx.reportSourceKind,
    ctx.cadenceMode,
  ]);

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
          automationId={ctx.automationId}
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
      {/* Try the real message straight from the destination section. */}
      <TestFireButton
        onTestFire={ctx.onTestFire}
        loading={ctx.testFireLoading}
        disabled={!isComplete(slice)}
        hint={
          isComplete(slice)
            ? undefined
            : slice.deliveryMethod === "bot"
              ? "Add a token and channel first"
              : "Add a webhook URL first"
        }
      />
      <FieldHeader
        label="Message"
        usingDefault={slice.template.usingDefault}
        onReset={() => onChange({ ...slice, template: EMPTY_FIELD })}
        trailing={<VariableInfoIcon variables={variables} />}
      />
      {isBlockKit ? (
        // Two modes, side by side: a guided gallery (Template) or the raw
        // Block Kit editor (Code). "Code" is a tab, not a buried disclosure —
        // plain text is the one remaining escape hatch below.
        <VStack align="stretch" gap={3}>
          <SegmentedControl
            size="sm"
            alignSelf="start"
            value={messageMode}
            onValueChange={({ value }) => {
              if (value) setMessageMode(value as "template" | "code");
            }}
            items={[
              { value: "template", label: "Template" },
              { value: "code", label: "Code" },
            ]}
          />
          {messageMode === "template" ? (
            autoLayout ? (
              // A dashboard IS its panels — there is no layout to choose, so the
              // gallery would be a menu of one. Switch to Code to edit the copy.
              <Text textStyle="xs" color="fg.muted">
                Every panel on the dashboard is sent as its own chart. There's
                nothing to lay out; switch to Code to edit the message yourself.
              </Text>
            ) : (
              <SlackBlockKitTemplatePicker
                cadence={ctx.cadenceMode}
                kind={ctx.sourceKind}
                reportSource={ctx.reportSourceKind}
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
                  // reset effect above sees a consistent pair and leaves it
                  // alone.
                  ctx.setNotificationCadence(
                    option.cadenceFit === "digest" ? "5min_digest" : "immediate",
                  );
                  onChange({
                    ...slice,
                    template: { value: option.source, usingDefault: false },
                  });
                }}
              />
            )
          ) : (
            // The raw Block Kit editor. This is the only place "Block Kit" and
            // Liquid braces are exposed. The `liquid-json` Monaco language
            // tokenizes the JSON and its embedded Liquid, and the Block Kit
            // schema drives in-editor markers.
            <VStack align="stretch" gap={2}>
              <Text textStyle="xs" color="fg.muted">
                Write the layout yourself in Block Kit. Values in braces fill in
                from your trace or alert when the message sends.
              </Text>
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
            </VStack>
          )}
          {slackPreview ? (
            <CompactSlackPreview payload={slackPreview.payload} />
          ) : null}
          {/* Escape hatch: write the message yourself as plain text. */}
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
  automationId,
}: {
  slice: SlackSlice;
  onChange: (next: SlackSlice) => void;
  projectId: string;
  automationId?: string;
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
        automationId={automationId}
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
  previewOptions,
  ConfigForm: SlackConfigForm,
};

export default client;
