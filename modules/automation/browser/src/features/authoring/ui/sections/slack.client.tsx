import {
  type SlackActionParams,
  type SlackPreview,
  slackDeliveryMethodOf,
  type SavedTriggerRow,
  defaultsForSourceKind,
  filterVariablesForCadence,
} from "@langwatch/automation-contract";
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
} from "@langwatch/design-system/primitives";
import { SegmentedControl } from "@langwatch/design-system/segmented-control";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { FaSlack } from "react-icons/fa";

import { api } from "../../../../behavior/automation-api.ts";
import { useDescribeError } from "../../../../behavior/automation-feedback.ts";
import { useSlackConnections } from "../../../../behavior/use-automation-reads.ts";
import type {
  ConfigFormProps,
  NotifyClientDef,
  SummaryIdentity,
} from "../../../../model/provider-types.ts";
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
import type { FieldDraft, SlackSlice } from "../../model/slack-slice.ts";
import { SlackConnectionPicker } from "../blocks/slack-connection-picker.tsx";
import { ReceiveCadenceField } from "../elements/receive-cadence-field.tsx";
import { AutomationTestFireButton } from "../elements/test-fire-button.tsx";
import { CompactSlackPreview, FieldHeader, LiquidEditor } from "./template-authoring.tsx";

const EMPTY_FIELD: FieldDraft = { value: "", usingDefault: true };

function initialSlice(): SlackSlice {
  // Block Kit by default: the gallery's layouts render far better in Slack than plain text.
  // Rows with a null template type read as plain text in `fromTriggerRow`.
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

/** A connection is chosen, plus a channel for a bot. A row still on its own secret keeps
 *  delivering, so it stays complete until a connection is picked. */
function isComplete(slice: SlackSlice): boolean {
  if (usesLegacySecret(slice)) return true;
  if (!slice.slackIntegrationId) return false;
  return slice.deliveryMethod !== "bot" || slice.channelId.trim().length > 0;
}

function testFireHint(slice: SlackSlice): string | undefined {
  if (isComplete(slice)) return undefined;
  return slice.slackIntegrationId ? "Pick a channel first" : "Pick a Slack connection first";
}

/** Names where it posts: the connection, and for a bot the channel. */
function summary(slice: SlackSlice, _identity: SummaryIdentity): string {
  if (usesLegacySecret(slice)) return "Slack (own secret)";
  if (!slice.slackIntegrationId) return "Slack (no connection)";
  const connection = slice.connectionName ? `Slack → ${slice.connectionName}` : "Slack connection";
  if (slice.deliveryMethod === "webhook") return connection;
  const channel = slice.channelId.trim().replace(/^#/, "");
  return channel ? `${connection} #${channel}` : `${connection} (channel not set)`;
}

function fromTriggerRow(row: SavedTriggerRow): SlackSlice {
  const params = (row.actionParams ?? {}) as Partial<SlackActionParams>;
  const slackIntegrationId =
    typeof params.slackIntegrationId === "string" ? params.slackIntegrationId : "";
  return {
    slackIntegrationId,
    deliveryMethod: slackDeliveryMethodOf(params),
    channelId: typeof params.slackChannelId === "string" ? params.slackChannelId : "",
    legacyParams: !slackIntegrationId && Object.keys(params).length > 0 ? params : null,
    templateType: row.slackTemplateType === "block_kit" ? "block_kit" : "string",
    template: {
      value: row.slackTemplate ?? "",
      usingDefault: row.slackTemplate == null,
    },
  };
}

/** The legacy row as it was read: the server moves the secret it still stores into a
 *  connection on save (ADR-093 §5a). */
function legacyWriteBack(params: Partial<SlackActionParams>): Partial<SlackActionParams> {
  const { slackBotTokenSet: _set, slackBotToken: _token, slackWebhook: _webhook, ...rest } = params;
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
      : { slackIntegrationId: slice.slackIntegrationId, slackDelivery: "webhook" };
  }
  if (slice.legacyParams) return legacyWriteBack(slice.legacyParams);
  return { slackDelivery: slice.deliveryMethod };
}

function comboboxEmptyLabel(isPending: boolean, channelCount: number): string {
  if (isPending) return "Loading channels…";
  if (channelCount === 0) return "Type a channel name or ID";
  return "No match: press Enter to use what you typed";
}

function testFireTarget(slice: SlackSlice) {
  const legacy = usesLegacySecret(slice) ? slice.legacyParams : null;
  return {
    webhook: legacy?.slackWebhook ?? null,
    botDestination:
      slice.deliveryMethod === "bot" ? { channelId: slice.channelId, botToken: null } : null,
    slackIntegrationId: slice.slackIntegrationId || null,
  };
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

type ChannelHint = { kind: "hint"; text: string } | { kind: "none" };

/**
 * A listing can succeed and still be short of the workspace; both gaps can apply at once, so
 * they are listed, not ranked — showing only the first would still miss the author's channel.
 */
function gapHintOf(gaps: readonly string[]): ChannelHint {
  const lines = [
    gaps.includes("private_channels_hidden")
      ? "Private channels aren't listed: your Slack app needs the groups:read permission. Reinstall it with the manifest from the Slack connection settings."
      : null,
    gaps.includes("page_cap")
      ? "This workspace has more channels than we can list here, so some are missing."
      : null,
  ].filter((line): line is string => line !== null);
  if (lines.length === 0) return { kind: "none" };
  return {
    kind: "hint",
    text: `${lines.join(" ")} Type the channel name or paste its ID above to use one that isn't shown.`,
  };
}

function channelHintOf({
  loadFailure,
  returnedError,
  gaps,
}: {
  loadFailure: string;
  returnedError: string | null | undefined;
  gaps: readonly string[];
}): ChannelHint {
  if (loadFailure) {
    return {
      kind: "hint",
      text: `${endWithStop(loadFailure)} You can still type the channel above.`,
    };
  }
  if (returnedError === "no_token") {
    return { kind: "hint", text: "This connection can't list channels. Type the channel above." };
  }
  if (returnedError === "missing_scope") {
    return {
      kind: "hint",
      text: "Add the channels:read permission to your Slack app and reinstall it to pick from a list. You can still type the channel above.",
    };
  }
  if (returnedError) {
    return {
      kind: "hint",
      text: "Couldn't load channels from Slack. Check the connection's token, or type the channel above.",
    };
  }
  return gapHintOf(gaps);
}

/** A channel typed but not listed stays a real destination, with its own entry. */
function channelOptionsWith({
  listed,
  customChannel,
  listedIds,
}: {
  listed: { label: string; value: string }[];
  customChannel: string;
  listedIds: Set<string>;
}): { label: string; value: string }[] {
  if (!customChannel || listedIds.has(customChannel)) return listed;
  return [...listed, { value: customChannel, label: customChannel }];
}

function ChannelFieldHeader({ isPending, onReload }: { isPending: boolean; onReload: () => void }) {
  return (
    <HStack justify="space-between" align="center" width="full">
      <Field.Label>Channel</Field.Label>
      <Button
        variant="plain"
        size="xs"
        height="auto"
        paddingX={0}
        color="fg.muted"
        _hover={{ color: "fg" }}
        disabled={isPending}
        onClick={onReload}
      >
        {isPending ? "Loading…" : "Reload"}
      </Button>
    </HStack>
  );
}

function ChannelInput({ isPending, onCommit }: { isPending: boolean; onCommit: () => void }) {
  return (
    <>
      <Combobox.Input
        placeholder={isPending ? "Loading channels…" : "#alerts or C0123…"}
        onBlur={onCommit}
        onKeyDown={(event) => {
          if (event.key === "Enter") onCommit();
        }}
      />
      <Combobox.IndicatorGroup>
        {isPending ? <Spinner size="xs" /> : null}
        <Combobox.Trigger />
      </Combobox.IndicatorGroup>
    </>
  );
}

function ChannelHintText({ hint, isError }: { hint: string; isError: boolean }) {
  return (
    <Text textStyle="xs" color={isError ? "fg.error" : "fg.muted"} pt={1}>
      {hint}
    </Text>
  );
}

/**
 * Channel field: a typeable combobox over the bot connection's channels. Picking stores the ID;
 * free typing is kept verbatim (committed on blur or Enter) so an unlisted channel still works.
 * A missing scope degrades to a hint, never a hard error.
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
  const describeError = useDescribeError();
  // Read the STABLE reference react-query hands back — `?? []` would mint a fresh
  // array every render and turn the "sync the collection" effect below into an
  // infinite render loop.
  const channelData = list.data?.channels;
  const channels = channelData ?? [];

  const fetchChannels = () =>
    list.mutate(
      { projectId, slackIntegrationId: slice.slackIntegrationId },
      { onError: (error) => console.error("[slack] listSlackChannels failed", error) },
    );

  // One listing per connection: the field is keyed on it, so this runs on mount.
  useEffect(() => {
    if (slice.slackIntegrationId) fetchChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slice.slackIntegrationId]);

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
    set(
      channelOptionsWith({
        listed: (channelData ?? []).map(channelOption),
        customChannel,
        listedIds,
      }),
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
    if (typed === null || typed === slice.channelId) return;
    // Typing over a picked channel replaces it, so the old pick must stop being the selection,
    // or the list keeps a tick beside a channel no longer this field's value. Clearing the
    // selection outright would blank the box ("nothing selected" stringifies to ""), so the
    // typed channel becomes the selection instead, backed by its own collection entry.
    if (!listedIds.has(typed)) setCustomChannel(typed);
    setSelectedId(typed);
    onChange({ ...slice, channelId: typed });
  };

  // A saved automation stores the channel ID, so the box would read "C0123…".
  // Promoting it to a real selection once the list can resolve it lets the
  // combobox fill in the channel NAME, which is what the author recognises.
  useEffect(() => {
    if (hasAuthorTyped.current) return;
    const stored = (channelData ?? []).find((c) => c.id === slice.channelId);
    if (stored) setSelectedId(stored.id);
  }, [channelData, slice.channelId]);

  const hintRead = channelHintOf({
    loadFailure: list.isError
      ? describeError({ error: list.error, fallbackTitle: "Couldn't load channels" })
      : "",
    returnedError: list.data?.error,
    gaps: list.data?.gaps ?? [],
  });
  const hint = hintRead.kind === "hint" ? hintRead.text : null;

  return (
    <Field.Root>
      <ChannelFieldHeader isPending={list.isPending} onReload={fetchChannels} />
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
          <ChannelInput isPending={list.isPending} onCommit={commitTypedChannel} />
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
      {hint ? <ChannelHintText hint={hint} isError={list.isError} /> : null}
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
 * The preview renders under the rules delivery will: a webhook strips the chart, table and
 * banner blocks, a bot renders them. A slice with nothing to deliver through yet previews the
 * stripped message.
 */
function previewOptions({ slice }: { slice: SlackSlice }): { allowGatedBlocks: boolean } {
  return {
    allowGatedBlocks:
      slice.deliveryMethod === "bot" && (!!slice.slackIntegrationId || usesLegacySecret(slice)),
  };
}

type SlackCtx = ConfigFormProps<SlackSlice, SlackPreview>["ctx"];

/** A preset written for another cadence, trigger kind or report source than the draft's. */
function presetMismatchesContext({
  preset,
  ctx,
}: {
  preset: NonNullable<ReturnType<typeof findTemplateOptionBySource>>;
  ctx: SlackCtx;
}): boolean {
  const cadenceMismatch = preset.cadenceFit !== "both" && preset.cadenceFit !== ctx.cadenceMode;
  const kindMismatch = preset.kind !== ctx.sourceKind;
  const reportSourceMismatch =
    preset.kind === "report" &&
    ctx.reportSourceKind !== undefined &&
    !(preset.reportSources ?? []).includes(ctx.reportSourceKind);
  return cadenceMismatch || kindMismatch || reportSourceMismatch;
}

function SlackBlockKitMessageBody({
  messageMode,
  autoLayout,
  variables,
  templateValue,
  slice,
  onChange,
  ctx,
}: {
  messageMode: "template" | "code";
  autoLayout: boolean;
  variables: ReturnType<typeof filterVariablesForCadence>;
  templateValue: string;
  slice: SlackSlice;
  onChange: (next: SlackSlice) => void;
  ctx: SlackCtx;
}) {
  if (messageMode !== "template") {
    // The raw Block Kit editor. This is the only place "Block Kit" and
    // Liquid braces are exposed. The `liquid-json` Monaco language
    // tokenizes the JSON and its embedded Liquid, and the Block Kit
    // schema drives in-editor markers.
    return (
      <VStack align="stretch" gap={2}>
        <Text textStyle="xs" color="fg.muted">
          Write the layout yourself in Block Kit. Values in braces fill in from your trace or alert
          when the message sends.
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
        Every panel on the dashboard is sent as its own chart. There's nothing to lay out; switch to
        Code to edit the message yourself.
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
    />
  );
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
  const connections = useSlackConnections({ projectId: ctx.projectId });
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
    if (!preset || !presetMismatchesContext({ preset, ctx })) return;
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

  return (
    <VStack align="stretch" gap={4}>
      <SlackConnectionPicker
        data={connections.data}
        refetch={connections.refetch}
        slice={slice}
        onChange={onChange}
      />
      {slice.slackIntegrationId && slice.deliveryMethod === "bot" ? (
        // Keyed on the connection: another workspace's channel list and pick must not carry over.
        <SlackChannelField
          key={slice.slackIntegrationId}
          projectId={ctx.projectId}
          slice={slice}
          onChange={onChange}
        />
      ) : null}
      {/* The receive choice sits beside the layouts it filters (`hasOwnReceiveChooser`); only a
          trace automation has it, the server pins alerts and reports to their own timing. */}
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
          <SlackBlockKitMessageBody
            messageMode={messageMode}
            autoLayout={autoLayout}
            variables={variables}
            templateValue={templateValue}
            slice={slice}
            onChange={onChange}
            ctx={ctx}
          />
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
      {/* After the layout choice: a test fire renders whatever is configured above. */}
      <AutomationTestFireButton
        onTestFire={ctx.onTestFire}
        loading={ctx.testFireLoading}
        disabled={!isComplete(slice)}
        hint={testFireHint(slice)}
      />
    </VStack>
  );
}

const client: NotifyClientDef<SlackSlice, SlackPreview> = {
  Icon: FaSlack,
  hasOwnReceiveChooser: true,
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
