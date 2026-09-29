import {
  Box,
  Button,
  Combobox,
  Field,
  HStack,
  Portal,
  Spinner,
  Text,
  useFilter,
  useListCollection,
  VStack,
} from "@chakra-ui/react";
import {
  type SlackActionParams,
  type SlackDeliveryMethod,
  type SlackPreview,
  type SlackTemplateType,
  slackDeliveryMethodOf,
} from "@langwatch/automations/providers/slack";
import type { SavedTriggerRow } from "@langwatch/automations/providers/types";
import { defaultsForSourceKind } from "@langwatch/automations/templating/defaults";
import { filterVariablesForCadence } from "@langwatch/automations/templating/exampleContext";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { FaSlack } from "react-icons/fa";
import { SegmentedControl } from "~/components/ui/segmented-control";
import { ReceiveCadenceField } from "~/features/automations/components/ReceiveCadenceField";
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
  SummaryIdentity,
} from "../types";
import { SlackConnectionPicker } from "./SlackConnectionPicker";
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
 *  applies, and pre-filled for a report. */
interface FieldDraft {
  value: string;
  usingDefault: boolean;
}

export interface SlackSlice {
  /** The Slack connection this automation delivers through (ADR-093 §5a).
   *  Empty until one is picked. */
  slackIntegrationId: string;
  /** The picked connection's name, for the summary line only. The drawer
   *  fills it for a saved row; never written into `actionParams`. */
  connectionName?: string;
  /** Follows the picked connection's kind: a bot posts to a channel and
   *  renders every block, a webhook posts to its own channel. */
  deliveryMethod: SlackDeliveryMethod;
  /** Bot destination channel (id like C0123, or #name). */
  channelId: string;
  /** A saved row that still carries a secret of its own and no connection.
   *  Written back untouched until the author picks a connection. */
  legacyParams: Partial<SlackActionParams> | null;
  templateType: SlackTemplateType;
  template: FieldDraft;
}

const EMPTY_FIELD: FieldDraft = { value: "", usingDefault: true };

function initialSlice(): SlackSlice {
  // Block Kit by default: the gallery's layouts render far better in Slack
  // than plain text. Rows with a null template type read as plain text in
  // `fromTriggerRow`, so historical configs are not retyped.
  return {
    slackIntegrationId: "",
    deliveryMethod: "bot",
    channelId: "",
    legacyParams: null,
    templateType: "block_kit",
    template: EMPTY_FIELD,
  };
}

/** A row with no connection that still delivers with a secret of its own. */
function usesLegacySecret(slice: SlackSlice): boolean {
  return !slice.slackIntegrationId && slice.legacyParams !== null;
}

/** A connection is chosen, plus a channel for a bot. A row still on its own
 *  secret keeps delivering, so it stays complete until a connection is picked. */
function isComplete(slice: SlackSlice): boolean {
  if (usesLegacySecret(slice)) return true;
  if (!slice.slackIntegrationId) return false;
  return slice.deliveryMethod !== "bot" || slice.channelId.trim().length > 0;
}

/** Names where it posts: the connection, and for a bot the channel. */
function summary(slice: SlackSlice, _identity: SummaryIdentity): string {
  if (usesLegacySecret(slice)) return "Slack (own secret)";
  if (!slice.slackIntegrationId) return "Slack (no connection)";
  const connection = slice.connectionName
    ? `Slack → ${slice.connectionName}`
    : "Slack connection";
  if (slice.deliveryMethod === "webhook") return connection;
  const channel = slice.channelId.trim().replace(/^#/, "");
  return channel
    ? `${connection} #${channel}`
    : `${connection} (channel not set)`;
}

function fromTriggerRow(row: SavedTriggerRow): SlackSlice {
  const params = (row.actionParams ?? {}) as Partial<SlackActionParams>;
  const slackIntegrationId =
    typeof params.slackIntegrationId === "string"
      ? params.slackIntegrationId
      : "";
  return {
    slackIntegrationId,
    deliveryMethod: slackDeliveryMethodOf(params),
    channelId:
      typeof params.slackChannelId === "string" ? params.slackChannelId : "",
    legacyParams:
      !slackIntegrationId && Object.keys(params).length > 0 ? params : null,
    templateType:
      row.slackTemplateType === "block_kit" ? "block_kit" : "string",
    template: {
      value: row.slackTemplate ?? "",
      usingDefault: row.slackTemplate == null,
    },
  };
}

/** The legacy row as it was read: the server moves the secret it still
 *  stores into a connection on save (ADR-093 §5a). */
function legacyWriteBack(
  params: Partial<SlackActionParams>,
): Partial<SlackActionParams> {
  const {
    slackBotTokenSet: _set,
    slackBotToken: _token,
    slackWebhook: _webhook,
    ...rest
  } = params;
  return rest;
}

function toActionParams(slice: SlackSlice): Partial<SlackActionParams> {
  if (slice.slackIntegrationId) {
    return slice.deliveryMethod === "bot"
      ? {
          slackIntegrationId: slice.slackIntegrationId,
          slackDelivery: "bot",
          slackChannelId: slice.channelId,
        }
      : {
          slackIntegrationId: slice.slackIntegrationId,
          slackDelivery: "webhook",
        };
  }
  if (slice.legacyParams) return legacyWriteBack(slice.legacyParams);
  return { slackDelivery: slice.deliveryMethod };
}

function testFireTarget(slice: SlackSlice) {
  const legacy = usesLegacySecret(slice) ? slice.legacyParams : null;
  return {
    webhook: legacy?.slackWebhook ?? null,
    botDestination:
      slice.deliveryMethod === "bot"
        ? { channelId: slice.channelId, botToken: null }
        : null,
    slackIntegrationId: slice.slackIntegrationId || null,
  };
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
 * Channel field: a typeable combobox. The picked bot connection's channels
 * drop in as filterable suggestions; picking one stores its ID, while free
 * typing is kept verbatim (committed on blur or Enter) so an unlisted channel
 * still works. A missing scope degrades to a hint, never a hard error.
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
  // Read the STABLE reference react-query hands back — `?? []` would mint a fresh
  // array every render and turn the "sync the collection" effect below into an
  // infinite render loop.
  const channelData = list.data?.channels;
  const channels = channelData ?? [];

  const fetchChannels = () =>
    list.mutate(
      { projectId, slackIntegrationId: slice.slackIntegrationId },
      {
        onError: (error) =>
          // The hint below reads `list.isError`; this is a dev echo only.
          // eslint-disable-next-line no-console
          console.error("[slack] listSlackChannels failed", error),
      },
    );

  // One listing per connection: the field is keyed on it, so this runs on mount.
  useEffect(() => {
    if (slice.slackIntegrationId) fetchChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slice.slackIntegrationId]);

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
      ? "Private channels aren't listed: your Slack app needs the groups:read permission. Reinstall it with the manifest from the Slack connection settings."
      : null,
    gaps.includes("page_cap")
      ? "This workspace has more channels than we can list here, so some are missing."
      : null,
  ].filter((line): line is string => line !== null);
  const gapHint = gapHints.length
    ? `${gapHints.join(" ")} Type the channel name or paste its ID above to use one that isn't shown.`
    : null;
  // `no_token` means the connection had nothing to list with; say so rather
  // than showing a load that silently did nothing.
  const hint = list.isError
    ? `${endWithStop(
        describeError({
          error: list.error,
          fallbackTitle: "Couldn't load channels",
        }),
      )} You can still type the channel above.`
    : list.data?.error === "no_token"
      ? "This connection can't list channels. Type the channel above."
      : returnedError === "missing_scope"
        ? "Add the channels:read permission to your Slack app and reinstall it to pick from a list. You can still type the channel above."
        : returnedError
          ? "Couldn't load channels from Slack. Check the connection's token, or type the channel above."
          : gapHint;

  // A connection that failed to list (scopes not yet granted) can start working
  // without the draft changing, so Reload asks again on demand.
  const handleReload = () => fetchChannels();

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
                    : "No match. Press Enter to use what you typed"}
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
 * The preview renders under the rules delivery will: a webhook strips the
 * chart, table and banner blocks, a bot renders them. A slice with nothing to
 * deliver through yet previews the stripped message.
 */
function previewOptions({ slice }: { slice: SlackSlice }): {
  allowGatedBlocks: boolean;
} {
  const hasLegacyBotToken = usesLegacySecret(slice);
  return {
    allowGatedBlocks:
      slice.deliveryMethod === "bot" &&
      (!!slice.slackIntegrationId || hasLegacyBotToken),
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
      <SlackConnectionPicker
        projectId={ctx.projectId}
        slice={slice}
        onChange={onChange}
      />
      {slice.slackIntegrationId && slice.deliveryMethod === "bot" ? (
        // Keyed on the connection: another workspace's channel list and pick
        // must not carry over.
        <SlackChannelField
          key={slice.slackIntegrationId}
          projectId={ctx.projectId}
          slice={slice}
          onChange={onChange}
        />
      ) : null}
      {/* The receive choice lives here, beside the layouts it filters — one
          decision drives both the cadence and which templates are offered
          (`hasOwnReceiveChooser`). Only a trace automation has the choice: the
          server pins alerts and reports to their own timing. */}
      {ctx.sourceKind === "trace" ? (
        <ReceiveCadenceField
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
            : slice.slackIntegrationId
              ? "Pick a channel first"
              : "Pick a Slack connection first"
        }
      />
    </VStack>
  );
}

const client: NotifyClientDef<SlackSlice, SlackPreview> = {
  Icon: FaSlack,
  channel: "slack",
  // The layout gallery depends on the receive choice, so the chooser renders
  // beside it (in SlackConfigForm) and the cadence facet stands down.
  hasOwnReceiveChooser: true,
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
