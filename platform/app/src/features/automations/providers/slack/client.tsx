import {
  Box,
  Button,
  Combobox,
  createListCollection,
  Field,
  HStack,
  Input,
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
} from "@langwatch/automations/providers/slack";
import type { SavedTriggerRow } from "@langwatch/automations/providers/types";
import { defaultsForSourceKind } from "@langwatch/automations/templating/defaults";
import { filterVariablesForCadence } from "@langwatch/automations/templating/exampleContext";
import { ExternalLink } from "lucide-react";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
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
} from "~/features/automations/editors/templateAuthoring";
import { describeError } from "~/features/errors";
import { api } from "~/utils/api";
import { TestFireButton } from "../TestFireButton";
import type {
  ConfigFormProps,
  NotifyClientDef,
  PreviewDeliveryContext,
  SummaryIdentity,
} from "../types";
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

/**
 * Which of the three token states a Slack delivery is in (ADR-093 §5). The
 * composer reads as exactly one of them, and they are ordered the way delivery
 * resolves: an automation's own token outranks the project integration, so an
 * automation that has one reads as using its own however the project is set up.
 */
export type SlackTokenState =
  | "own_token"
  | "project_integration"
  | "not_connected";

export function slackTokenState({
  slice,
  projectIntegrationConnected,
}: {
  slice: SlackSlice;
  projectIntegrationConnected: boolean;
}): SlackTokenState {
  if (slice.botTokenAlreadySet || slice.botToken.trim().length > 0) {
    return "own_token";
  }
  return projectIntegrationConnected ? "project_integration" : "not_connected";
}

function slackTokenAvailable(params: {
  slice: SlackSlice;
  projectIntegrationConnected: boolean;
}): boolean {
  return slackTokenState(params) !== "not_connected";
}

/**
 * Completeness is what the AUTHOR still has to fill in, and the token is no
 * longer one of those things: it belongs to the project, not to this
 * automation. A project with no Slack integration is a real problem, but it is
 * the project's to fix and delivery names it (`slack_integration_missing`)
 * rather than the composer blocking a save over it.
 */
function isComplete(slice: SlackSlice): boolean {
  if (slice.deliveryMethod === "bot") {
    return slice.channelId.trim().length > 0;
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
            Get charts, tables, and status banners
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
function channelOption(channel: {
  id: string;
  name: string;
  isPrivate?: boolean;
}) {
  return {
    value: channel.id,
    label: `${channel.isPrivate ? "🔒 " : "#"}${channel.name}`,
  };
}

/**
 * Terminates a sentence so another can follow it.
 *
 * `describeError` only ends in a full stop when the code has body copy to add
 * — a bare title ("Couldn't load channels") comes back unpunctuated — and the
 * hint below always glues the "you can still type it" affordance on the end.
 */
function endWithStop(sentence: string): string {
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/**
 * Channel field: a typeable combobox. Manual entry always works (type a name or
 * paste an ID); once a token is present the channel list is fetched
 * AUTOMATICALLY and drops in as filterable suggestions. Picking a suggestion
 * stores the channel ID (what `chat.postMessage` wants), while free typing is
 * kept verbatim so a custom / not-yet-listed channel still works — committed
 * on blur or Enter, not on every keystroke. A missing scope degrades to a
 * hint, never a hard error.
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
          // The hint below already reads `list.isError` / `list.error`, so
          // this is a dev-diagnostic echo, not the only place the failure
          // surfaces to the author.
          // eslint-disable-next-line no-console
          console.error("[slack] listSlackChannels failed", error),
      },
    );
  };

  // Fetch straight away and let the server resolve which token to list with
  // (ADR-093 §5): the automation's own stored one, else the project's Slack
  // integration. A freshly typed token is still honoured — the public API can
  // still write one — and is debounced so we don't fire mid-type. Nothing to
  // resolve comes back as `no_token`, which the hint below names.
  const fetchKey = typedToken
    ? /^xoxb-/.test(typedToken)
      ? `typed:${typedToken}`
      : null
    : "resolved";
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
  // A channel the bot can't list is still a real destination, so it gets its
  // own entry once committed. That entry is what lets it be the combobox's
  // SELECTION: the machine rewrites its input from the selected item's label,
  // and an entry whose label is the typed text survives that rewrite unchanged.
  const [customChannel, setCustomChannel] = useState("");
  const listedIds = useMemo(
    () => new Set((channelData ?? []).map((c) => c.id)),
    [channelData],
  );
  useEffect(() => {
    const listed = (channelData ?? []).map(channelOption);
    set(
      customChannel && !listedIds.has(customChannel)
        ? [...listed, { value: customChannel, label: customChannel }]
        : listed,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelData, customChannel]);

  // The channel actually PICKED from the list — deliberately NOT
  // `slice.channelId`, which also holds free-typed text. The combobox rewrites
  // its own input to the selected item's label every time its `value` changes,
  // so feeding half-typed text back as `value` wiped the box on every
  // keystroke: the search never got past one character, and any channel that
  // needed a longer search was unreachable.
  const [selectedId, setSelectedId] = useState("");
  // Once the author starts typing, the field is theirs — nothing below may
  // reach in and rewrite what they are searching for.
  const hasAuthorTyped = useRef(false);

  // Text typed but not yet committed to the slice. A ref, not state, and
  // deliberately NOT written through on every keystroke: writing the slice
  // re-renders this whole form, and the combobox resyncs the input element
  // from a PASSIVE effect, so the resync lands a render late and overwrites
  // characters typed in between — "#adhoc" arrives as "#ahc". The search stays
  // live on every keystroke; only the commit waits for the author to finish.
  const pendingText = useRef<string | null>(null);
  const commitTypedChannel = () => {
    const typed = pendingText.current;
    pendingText.current = null;
    if (typed !== null && typed !== slice.channelId) {
      // Typing over a picked channel replaces it, so the old pick must stop
      // being the selection — otherwise the list keeps a tick beside a channel
      // that is no longer this field's value. Clearing the selection outright
      // would blank the box (the combobox rewrites its input from the selected
      // item, and "nothing selected" stringifies to ""), so the typed channel
      // becomes the selection instead, backed by its own collection entry.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelData, slice.channelId]);

  const returnedError =
    list.data?.error && list.data.error !== "no_token" ? list.data.error : null;
  // A listing can succeed and still be short of the workspace. Saying nothing
  // is the worst option: the author scrolls a list that looks complete, doesn't
  // find their channel, and concludes the integration is broken.
  // Both gaps can apply at once — an app without `groups:read` whose public
  // channels then outrun the page budget — so they are listed, not ranked.
  // Showing only the first would have the author fix one cause and still not
  // find their channel.
  const gaps = list.data?.gaps ?? [];
  const gapHints = [
    gaps.includes("private_channels_hidden")
      ? "Private channels aren't listed — your Slack app needs the groups:read permission. Reinstall it with the manifest in this project's integration settings."
      : null,
    gaps.includes("page_cap")
      ? "This workspace has more channels than we can list here, so some are missing."
      : null,
  ].filter((line): line is string => line !== null);
  const gapHint = gapHints.length
    ? `${gapHints.join(" ")} Type the channel name or paste its ID above to use one that isn't shown.`
    : null;
  // `no_token` means a load ran with nothing to load against — the "manual
  // reload with no usable token yet" case a mid-typed token can hit even
  // though the field isn't empty. Saying nothing here reads as a load that
  // silently did nothing; name the cause instead.
  const hint = list.isError
    ? `${endWithStop(
        describeError({
          error: list.error,
          fallbackTitle: "Couldn't load channels",
        }),
      )} You can still type the channel above.`
    : list.data?.error === "no_token"
      ? "Connect Slack for this project to see its channels."
      : returnedError === "missing_scope"
        ? "Add the channels:read permission to your Slack app and reinstall it to pick from a list — you can still type the channel above."
        : returnedError
          ? "Couldn't load channels from Slack. Check the token, or type the channel above."
          : gapHint;

  // A token that failed to list once (app not yet installed, scopes not yet
  // granted) can become valid without the field changing — the author fixes
  // it in Slack and comes back to the same draft. The automatic effect above
  // won't retry on its own once a key has been attempted (by design — it
  // isn't a poll), so Reload resets the latch before firing: the same key is
  // fetched again instead of being treated as already tried.
  const handleReload = () => {
    lastFetched.current = null;
    fetchChannels(fetchKey ?? `manual:${Date.now()}`);
  };

  return (
    <Field.Root>
      <HStack justify="space-between" align="center" width="full">
        <Field.Label>Channel</Field.Label>
        <Button
          variant="plain"
          size="xs"
          height="auto"
          paddingX={0}
          color="fg.muted"
          _hover={{ color: "fg" }}
          disabled={list.isPending}
          onClick={handleReload}
        >
          {list.isPending ? "Loading…" : "Reload"}
        </Button>
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
            placeholder={
              list.isPending ? "Loading channels…" : "#alerts or C0123…"
            }
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
 *
 * A bot connection with no token anywhere sends nothing at all (ADR-093 §5), so
 * the gate keys off token availability, not off the delivery method alone: the
 * automation's own token, or the project's Slack integration behind it.
 */
function previewOptions(
  slice: SlackSlice,
  context: PreviewDeliveryContext,
): { allowGatedBlocks: boolean } {
  return {
    allowGatedBlocks:
      slice.deliveryMethod === "bot" &&
      slackTokenAvailable({
        slice,
        projectIntegrationConnected: context.projectSlackIntegrationConnected,
      }),
  };
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
              ? "This automation uses a webhook. Move it to a Slack app for charts, tables, and status banners."
              : "Renders charts, tables, and status banners."}
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
                    option.cadenceFit === "digest"
                      ? "5min_digest"
                      : "immediate",
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
                from your trace or metric when the message sends.
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
      {/* Sits after the layout choice — a test fire renders whatever is
          configured above, so it belongs after there is something to try. */}
      <TestFireButton
        onTestFire={ctx.onTestFire}
        loading={ctx.testFireLoading}
        disabled={!isComplete(slice)}
        hint={
          isComplete(slice)
            ? undefined
            : slice.deliveryMethod === "bot"
              ? "Pick a channel first"
              : "Add a webhook URL first"
        }
      />
    </VStack>
  );
}

/**
 * Bot-connection destination. Since ADR-093 §5 the composer never asks for a
 * token — Slack is connected once per project and the channel is the only
 * decision left here. What the author sees is one of exactly three states:
 *
 *   own_token           this automation carries its own token, kept until it is
 *                       explicitly switched over, with the switch offered here
 *   project_integration the project's Slack workspace serves it — channel only
 *   not_connected       nothing to deliver with, so the way forward is settings
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
  const integration = api.slackIntegration.getStatus.useQuery(
    { projectId },
    { enabled: !!projectId, refetchOnWindowFocus: false },
  );
  const state = slackTokenState({
    slice,
    projectIntegrationConnected: integration.data?.connected ?? false,
  });

  return (
    <VStack align="stretch" gap={3}>
      {state === "own_token" ? (
        <OwnTokenNotice
          projectId={projectId}
          automationId={automationId}
          projectIntegrationConnected={integration.data?.connected ?? false}
          onSwitched={() =>
            onChange({ ...slice, botToken: "", botTokenAlreadySet: false })
          }
        />
      ) : state === "project_integration" ? (
        <ConnectedWorkspaceNotice
          workspaceName={integration.data?.slackTeamName ?? null}
        />
      ) : (
        <ConnectSlackNotice />
      )}
      {state === "not_connected" ? null : (
        <SlackChannelField
          projectId={projectId}
          automationId={automationId}
          slice={slice}
          onChange={onChange}
        />
      )}
    </VStack>
  );
}

/** State one: this automation stores its own token. It keeps delivering with
 *  it — the switch is a decision, never something the project makes for it. */
function OwnTokenNotice({
  projectId,
  automationId,
  projectIntegrationConnected,
  onSwitched,
}: {
  projectId: string;
  automationId?: string;
  projectIntegrationConnected: boolean;
  onSwitched: () => void;
}) {
  const utils = api.useContext();
  const switchOver = api.slackIntegration.switchToIntegration.useMutation({
    onSuccess: () => {
      onSwitched();
      void utils.slackIntegration.getLegacyTokenCensus.invalidate({
        projectId,
      });
    },
  });

  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      bg="bg.subtle"
      padding={3}
    >
      <VStack align="stretch" gap={2}>
        <Text textStyle="xs" fontWeight="medium" color="fg">
          Uses its own Slack token
        </Text>
        <Text textStyle="xs" color="fg.muted">
          {projectIntegrationConnected
            ? "This automation posts with a token saved on it, not the workspace connected for this project. Switching removes the saved token so it posts with the project's Slack connection instead."
            : "This automation posts with a token saved on it. Connect Slack for this project to manage it in one place."}
        </Text>
        {switchOver.isError ? (
          <Text textStyle="xs" color="fg.error">
            {describeError({
              error: switchOver.error,
              fallbackTitle: "Couldn't switch this automation",
            })}
          </Text>
        ) : null}
        <HStack gap={3}>
          {projectIntegrationConnected && automationId ? (
            <Button
              size="xs"
              variant="outline"
              alignSelf="flex-start"
              loading={switchOver.isPending}
              onClick={() =>
                switchOver.mutate({
                  projectId,
                  automationIds: [automationId],
                })
              }
            >
              Use the project integration
            </Button>
          ) : null}
          <Link href="/settings/integrations" textStyle="xs">
            Slack integration settings
          </Link>
        </HStack>
      </VStack>
    </Box>
  );
}

/** State two: the project's workspace serves this automation. Naming the
 *  workspace is the point — the author is picking a channel inside it. */
function ConnectedWorkspaceNotice({
  workspaceName,
}: {
  workspaceName: string | null;
}) {
  return (
    <Text textStyle="xs" color="fg.muted">
      {workspaceName
        ? `Posts to the ${workspaceName} Slack workspace connected for this project.`
        : "Posts to the Slack workspace connected for this project."}
    </Text>
  );
}

/** State three: nothing to deliver with. The way forward is the settings card,
 *  which is also where creating the Slack app is explained. */
function ConnectSlackNotice() {
  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      bg="bg.subtle"
      padding={3}
    >
      <VStack align="stretch" gap={2}>
        <Text textStyle="xs" fontWeight="medium" color="fg">
          Slack isn&rsquo;t connected for this project
        </Text>
        <Text textStyle="xs" color="fg.muted">
          Connect a Slack workspace once for the project, and every automation
          in it can post to a channel without its own token.
        </Text>
        <Link
          href="/settings/integrations"
          textStyle="xs"
          fontWeight="medium"
          display="inline-flex"
          alignItems="center"
          gap={1}
        >
          Connect Slack for this project <ExternalLink size={12} />
        </Link>
      </VStack>
    </Box>
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
