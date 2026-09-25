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
import {
  SLACK_BOT_TOKEN_KEPT,
  type SlackActionParams,
  type SlackDeliveryMethod,
  type SlackPreview,
  type SlackTemplateType,
  slackDeliveryMethodOf,
  type SavedTriggerRow,
  defaultsForSourceKind,
  filterVariablesForCadence,
} from "@langwatch/automation-contract";
import { SegmentedControl } from "@langwatch/design-system/segmented-control";
import { Select } from "@langwatch/design-system/select";
import { nowInstant } from "@langwatch/time";
import { ExternalLink } from "lucide-react";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { FaSlack } from "react-icons/fa";

import { api } from "../../../../behavior/automation-api.ts";
import { useDescribeError } from "../../../../behavior/automation-feedback.ts";
import type {
  ConfigFormProps,
  NotifyClientDef,
  SummaryIdentity,
} from "../../../../model/provider-types.ts";
import { Link } from "../../../../ui/elements/automation-link.tsx";
import {
  SLACK_BLOCK_KIT_JSON_SCHEMA,
  VariableInfoIcon,
  LIQUID_JSON_LANGUAGE_ID,
} from "../../../liquid-editor/index.ts";
import {
  findTemplateOptionBySource,
  pickDefaultSlackBlockKitTemplateId,
  reportSourceIsAutoLayout,
  SLACK_BLOCK_KIT_TEMPLATES,
  SlackBlockKitTemplatePicker,
} from "../../../slack-templates/index.ts";
import { AutomationTestFireButton } from "../elements/test-fire-button.tsx";
import {
  CompactSlackPreview,
  FieldHeader,
  LiquidEditor,
  TemplateDisclosure,
} from "./template-authoring.tsx";

/**
 * A template field. `usingDefault` means not customised (Reset and the default badge read it).
 * `value` is what will be sent: empty under the framework default, pre-filled for a report.
 */
interface FieldDraft {
  value: string;
  usingDefault: boolean;
}

export interface SlackSlice {
  /**
   * How the message reaches Slack: a legacy incoming webhook, or a Slack app bot token posting via
   * the Web API. Drives which destination fields and which templates are offered.
   */
  deliveryMethod: SlackDeliveryMethod;
  /** Webhook destination (used when `deliveryMethod` is "webhook"). */
  webhook: string;
  /**
   * A newly typed bot token. Empty means "unchanged": on an edit the server keeps the stored token;
   * on a fresh draft an empty token is incomplete. The stored token is never read back into the
   * form (see `botTokenAlreadySet`).
   */
  botToken: string;
  /** Bot destination channel (id like C0123, or #name). */
  channelId: string;
  /**
   * True when the row already has a stored bot token (echoed by the server as a flag, never the
   * token itself), so the form can show "token set" and let the author keep it without retyping.
   */
  botTokenAlreadySet: boolean;
  /**
   * True only when editing an automation saved with a webhook. New automations are bot-only; the
   * webhook option exists only to keep old ones editable.
   */
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

function testFireHint(slice: SlackSlice): string | undefined {
  if (isComplete(slice)) return undefined;
  if (slice.deliveryMethod === "bot") return "Add a token and channel first";
  return "Add a webhook URL first";
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
    channelId: typeof params.slackChannelId === "string" ? params.slackChannelId : "",
    botTokenAlreadySet: params.slackBotTokenSet === true,
    templateType: row.slackTemplateType === "block_kit" ? "block_kit" : "string",
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
    let slackBotToken: string;
    if (typed.length > 0) {
      slackBotToken = typed;
    } else if (slice.botTokenAlreadySet) {
      slackBotToken = SLACK_BOT_TOKEN_KEPT;
    } else {
      slackBotToken = "";
    }
    return {
      slackDelivery: "bot",
      slackChannelId: slice.channelId,
      slackBotToken,
    };
  }
  return { slackDelivery: "webhook", slackWebhook: slice.webhook };
}

function comboboxEmptyLabel(isPending: boolean, channelCount: number): string {
  if (isPending) return "Loading channels…";
  if (channelCount === 0) return "Type a channel name or ID";
  return "No match: press Enter to use what you typed";
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

// Slack app manifest with required OAuth scopes and bot_user feature for workspace-wide
// message posting without setup snags.
export const SLACK_APP_MANIFEST = `display_information:
  name: LangWatch
features:
  bot_user:
    display_name: LangWatch
    always_online: false
oauth_config:
  scopes:
    bot:
      - chat:write
      - chat:write.public
      - channels:read
      - groups:read`;

/**
 * Shown on a legacy webhook automation: nudges the author to move to a Slack app, which unlocks the
 * richer templates a webhook can't render.
 */
function UpgradeToBotBanner({ onUpgrade }: { onUpgrade: () => void }) {
  return (
    <Box borderWidth="1px" borderColor="border.muted" borderRadius="md" bg="bg.subtle" padding={3}>
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

/** One channel as the picker shows it: the ID is stored, the name is read. */
function channelOption(channel: { id: string; name: string; isPrivate?: boolean }) {
  return {
    value: channel.id,
    label: `${channel.isPrivate ? "🔒 " : "#"}${channel.name}`,
  };
}

/**
 * Terminates a sentence so another can follow it. `describeError` only ends in a full stop
 * when the code has body copy to add — a bare title ("Couldn't load channels") comes back
 * unpunctuated — and the hint below always glues the "you can still type it" affordance on.
 */
function endWithStop(sentence: string): string {
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

// Flexible channel selector: typeable combobox supporting manual entry and fetched suggestions;
// gracefully degrades when Slack token lacks required scopes.
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
  const describeError = useDescribeError();
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
        onError: (error) => console.error("[slack] listSlackChannels failed", error),
      },
    );
  };

  // Fetch as soon as a usable token exists — a freshly typed one (debounced so
  // we don't fire mid-type) or the stored token of a saved automation (loaded
  // server-side by id). No button to click; the list just appears.
  let fetchKey: string | null;
  if (typedToken) {
    fetchKey = typedToken.startsWith("xoxb-") ? `typed:${typedToken}` : null;
  } else if (slice.botTokenAlreadySet || automationId) {
    fetchKey = "stored";
  } else {
    fetchKey = null;
  }
  const lastFetched = useRef<string | null>(null);
  useEffect(() => {
    if (!fetchKey || lastFetched.current === fetchKey) return;
    const delay = fetchKey.startsWith("typed:") ? 600 : 0;
    const timer = setTimeout(() => fetchChannels(fetchKey), delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey]);

  // Filterable collection, refreshed whenever a fetch lands.
  const collator = useFilter({ sensitivity: "base" });
  const { collection, filter, set } = useListCollection<{
    label: string;
    value: string;
  }>({
    initialItems: [],
    filter: (itemText: string, filterText: string) => collator.contains(itemText, filterText),
  });
  // A channel the bot can't list is still a real destination, so it gets its
  // own entry once committed. That entry is what lets it be the combobox's
  // SELECTION: the machine rewrites its input from the selected item's label,
  // and an entry whose label is the typed text survives that rewrite unchanged.
  const [customChannel, setCustomChannel] = useState("");
  const listedIds = useMemo(() => new Set((channelData ?? []).map((c) => c.id)), [channelData]);
  useEffect(() => {
    const listed = (channelData ?? []).map(channelOption);
    set(
      customChannel && !listedIds.has(customChannel)
        ? [...listed, { value: customChannel, label: customChannel }]
        : listed,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelData, customChannel]);

  // The channel actually PICKED from the list — deliberately NOT `slice.channelId`, which also
  // holds free-typed text. The combobox rewrites its input to the selected item's label on every
  // `value` change, so feeding half-typed text back as `value` wiped the box on every keystroke —
  // the search never got past one character.
  const [selectedId, setSelectedId] = useState("");
  // Once the author starts typing, the field is theirs — nothing below may
  // reach in and rewrite what they are searching for.
  const hasAuthorTyped = useRef(false);

  // Text typed but not yet committed to the slice. A ref, not state — writing the slice on
  // every keystroke re-renders the form, and the combobox's PASSIVE resync effect then lands
  // a render late and eats characters typed in between ("#adhoc" arrives as "#ahc"). The search
  // stays live on every keystroke; only the commit waits for the author to finish.
  const pendingText = useRef<string | null>(null);
  const commitTypedChannel = () => {
    const typed = pendingText.current;
    pendingText.current = null;
    if (typed !== null && typed !== slice.channelId) {
      // Typing over a picked channel replaces it, so the old pick must stop being the selection,
      // or the list keeps a tick beside a channel no longer this field's value. Clearing the
      // selection outright would blank the box ("nothing selected" stringifies to ""), so the
      // typed channel becomes the selection instead, backed by its own collection entry.
      if (!listedIds.has(typed)) setCustomChannel(typed);
      setSelectedId(typed);
      onChange({ ...slice, channelId: typed });
    }
  };

  // A saved automation stores the channel ID, so the box would read "C0123…".
  // Promoting it to a real selection once the list can resolve it lets the
  // combobox fill in the channel NAME, which is what the author recognises.
  useEffect(() => {
    if (hasAuthorTyped.current) return;
    const stored = (channelData ?? []).find((c) => c.id === slice.channelId);
    if (stored) setSelectedId(stored.id);
  }, [channelData, slice.channelId]);

  const canLoad = typedToken.length > 0 || slice.botTokenAlreadySet || !!automationId;
  const returnedError = list.data?.error && list.data.error !== "no_token" ? list.data.error : null;
  // A listing can succeed and still be short of the workspace — saying nothing is the worst
  // option, since the author scrolls a list that looks complete, doesn't find their channel,
  // and concludes the integration is broken. Both gaps can apply at once, so they are listed,
  // not ranked; showing only the first would fix one cause and still miss their channel.
  const gaps = list.data?.gaps ?? [];
  const gapHints = [
    gaps.includes("private_channels_hidden")
      ? "Private channels aren't listed: your Slack app needs the groups:read permission. Reinstall it with the manifest above."
      : null,
    gaps.includes("page_cap")
      ? "This workspace has more channels than we can list here, so some are missing."
      : null,
  ].filter((line): line is string => line !== null);
  const gapHint = gapHints.length
    ? `${gapHints.join(" ")} Type the channel name or paste its ID above to use one that isn't shown.`
    : null;
  let hint: string | null;
  if (list.isError) {
    hint = `${endWithStop(
      describeError({
        error: list.error,
        fallbackTitle: "Couldn't load channels",
      }),
    )} You can still type the channel above.`;
  } else if (returnedError === "missing_scope") {
    hint =
      "Add the channels:read permission to your Slack app and reinstall it to pick from a list: you can still type the channel above.";
  } else if (returnedError) {
    hint = "Couldn't load channels from Slack. Check the token, or type the channel above.";
  } else {
    hint = gapHint;
  }

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
            onClick={() => fetchChannels(fetchKey ?? `manual:${nowInstant().epochMilliseconds}`)}
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
        value={selectedId ? [selectedId] : []}
        // The stored channel shows through immediately — as its ID at first,
        // upgraded to its name by the effect above once the list resolves it.
        defaultInputValue={slice.channelId}
        onValueChange={(details) => {
          // A pick beats whatever was half-typed, and stores the ID rather
          // than the "#name" label the author sees.
          pendingText.current = null;
          setSelectedId(details.value[0] ?? "");
          onChange({ ...slice, channelId: details.value[0] ?? "" });
        }}
        onInputValueChange={(details) => {
          startTransition(() => filter(details.inputValue));
          // Free entry (paste an ID / type a name that isn't listed) is held
          // until the author leaves the field — see `commitTypedChannel`.
          if (details.reason === "input-change") {
            hasAuthorTyped.current = true;
            pendingText.current = details.inputValue;
          }
        }}
        onOpenChange={(details) => {
          if (details.open) filter("");
        }}
      >
        <Combobox.Control>
          <Combobox.Input
            placeholder={list.isPending ? "Loading channels…" : "#alerts or C0123…"}
            onBlur={commitTypedChannel}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitTypedChannel();
            }}
          />
          <Combobox.IndicatorGroup>
            {list.isPending ? <Spinner size="xs" /> : null}
            <Combobox.Trigger />
          </Combobox.IndicatorGroup>
        </Combobox.Control>
        <Portal>
          <Combobox.Positioner zIndex="max">
            <Combobox.Content>
              <Combobox.Empty>{comboboxEmptyLabel(list.isPending, channels.length)}</Combobox.Empty>
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
        <Text textStyle="xs" color={list.isError ? "fg.error" : "fg.muted"} pt={1}>
          {hint}
        </Text>
      ) : null}
    </Field.Root>
  );
}

function templatesFromSlice(slice: SlackSlice) {
  const template = slice.template.value;
  return {
    emailSubjectTemplate: null,
    emailBodyTemplate: null,
    // The template the author is looking at is the template we store — whether
    // they wrote it, picked it from the gallery, or it was seeded from the
    // report's content source. An empty field means no template of our own, so
    // the framework default applies.
    slackTemplate: template.trim().length > 0 ? template : null,
    // Always carry the toggle. A null `slackTemplate` paired with a
    // non-null `slackTemplateType` means "use the framework default for
    // this type" — without this the server can't tell apart a user who
    // wants the block_kit default from a user who wants the plain-text
    // default, and falls back to text either way.
    slackTemplateType: slice.templateType,
  };
}

/**
 * The preview must render under the SAME rules delivery will: a webhook strips the modern
 * blocks to their fallback, a bot connection renders them. Previewing a chart the webhook
 * would strip — or hiding one the bot would send — makes the editor feel like it is lying.
 */
function previewOptions(slice: SlackSlice) {
  return { allowGatedBlocks: slice.deliveryMethod === "bot" };
}

function SlackConfigForm({ slice, onChange, ctx }: ConfigFormProps<SlackSlice, SlackPreview>) {
  const isBlockKit = slice.templateType === "block_kit";
  const isReport = ctx.sourceKind === "report";
  // A dashboard report maps straight onto its panels — no layout to pick.
  const autoLayout = isReport && reportSourceIsAutoLayout(ctx.reportSourceKind);
  // The editor must seed the same default dispatch renders for this kind —
  // otherwise the shown template and the sent message disagree.
  const defaults = defaultsForSourceKind(ctx.sourceKind);
  const templateDefault = isBlockKit ? defaults.slackBlockKit : defaults.slackString;
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
    isBlockKit && !slice.template.usingDefault && !findTemplateOptionBySource(slice.template.value);
  const [messageMode, setMessageMode] = useState<"template" | "code">(
    isCustomBlockKit ? "code" : "template",
  );

  // Reset preset template to framework default when cadence, trigger kind, or report source
  // doesn't match; never reset author-written templates.
  useEffect(() => {
    const preset = findTemplateOptionBySource(slice.template.value);
    if (!preset) return;
    const cadenceMismatch = preset.cadenceFit !== "both" && preset.cadenceFit !== ctx.cadenceMode;
    const kindMismatch = preset.kind !== ctx.sourceKind;
    const reportSourceMismatch =
      preset.kind === "report" &&
      ctx.reportSourceKind !== undefined &&
      !(preset.reportSources ?? []).includes(ctx.reportSourceKind);
    if (!cadenceMismatch && !kindMismatch && !reportSourceMismatch) return;
    onChange({ ...slice, template: EMPTY_FIELD });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.cadenceMode, ctx.sourceKind, ctx.reportSourceKind]);

  // Seed matching layout for reports using bundled templates; Reset restores seeded layout on
  // unsaved drafts.
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
  }, [isReport, isBlockKit, slice.template.usingDefault, ctx.reportSourceKind, ctx.cadenceMode]);

  const usePlainText = () => onChange({ ...slice, templateType: "string", template: EMPTY_FIELD });
  const useGuidedTemplates = () =>
    onChange({ ...slice, templateType: "block_kit", template: EMPTY_FIELD });

  function renderBlockKitMessageBody() {
    if (messageMode !== "template") {
      // The raw Block Kit editor. This is the only place "Block Kit" and
      // Liquid braces are exposed. The `liquid-json` Monaco language
      // tokenizes the JSON and its embedded Liquid, and the Block Kit
      // schema drives in-editor markers.
      return (
        <VStack align="stretch" gap={2}>
          <Text textStyle="xs" color="fg.muted">
            Write the layout yourself in Block Kit. Values in braces fill in from your trace or
            alert when the message sends.
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
      );
    }

    if (autoLayout) {
      // A dashboard IS its panels — there is no layout to choose, so the
      // gallery would be a menu of one. Switch to Code to edit the copy.
      return (
        <Text textStyle="xs" color="fg.muted">
          Every panel on the dashboard is sent as its own chart. There's nothing to lay out; switch
          to Code to edit the message yourself.
        </Text>
      );
    }

    return (
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
          ctx.setNotificationCadence(option.cadenceFit === "digest" ? "5min_digest" : "immediate");
          onChange({
            ...slice,
            template: { value: option.source, usingDefault: false },
          });
        }}
      />
    );
  }

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
          <UpgradeToBotBanner onUpgrade={() => onChange({ ...slice, deliveryMethod: "bot" })} />
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
      <AutomationTestFireButton
        onTestFire={ctx.onTestFire}
        loading={ctx.testFireLoading}
        disabled={!isComplete(slice)}
        hint={testFireHint(slice)}
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
          {renderBlockKitMessageBody()}
          {slackPreview ? <CompactSlackPreview payload={slackPreview.payload} /> : null}
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
            Write the message Slack will post. Markdown and variables are supported.
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
          {slackPreview ? <CompactSlackPreview payload={slackPreview.payload} /> : null}
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
 * Bot-connection destination: the channel to post in plus the app's bot token. The token is
 * write-only from the browser's side — once stored, the server echoes a "set" flag instead of
 * the secret, so the field stays blank and the author keeps it unless they type a new one.
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
            Post to your Slack workspace with a bot token. Create a Slack app, then paste its token
            below.
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
                  Create the app with &ldquo;From a manifest&rdquo; and paste the copied manifest:
                  it sets the permissions for you.
                </Text>
              </List.Item>
              <List.Item>
                <Text textStyle="xs" color="fg.muted">
                  Install it to your workspace and copy the Bot User OAuth Token (
                  <Code size="sm">xoxb-</Code>).
                </Text>
              </List.Item>
              <List.Item>
                <Text textStyle="xs" color="fg.muted">
                  Public channels work straight away. To post to a private channel, add the app to
                  that channel first.
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
            slice.botTokenAlreadySet ? "•••••••• (unchanged, leave blank to keep)" : "xoxb-…"
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
 * Picks an existing Slack webhook off another automation — most teams share one Slack channel
 * for alerts, and copying the URL between rows by hand is friction with no upside, since it's
 * the same secret across triggers. Hidden when no other Slack automation exists.
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

  const collection = useMemo(() => createListCollection({ items: options }), [options]);

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
