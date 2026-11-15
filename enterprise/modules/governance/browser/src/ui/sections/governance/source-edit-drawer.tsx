// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Drawer } from "@langwatch/design-system/drawer";
import { FieldInfoTooltip } from "@langwatch/design-system/field-info-tooltip";
import { Input, Text, Textarea, VStack } from "@langwatch/design-system/primitives";
import { type ReactNode, useState } from "react";

import { useGovernanceToaster } from "../../../behavior/governance-feedback.ts";
import {
  isOttlEnabledSourceType,
  needsIngestSecret,
  routesConversations,
  SOURCE_TYPE_LABEL,
  type SourceType,
} from "../../../features/ingestion-sources/model/ingestion-source-catalog.ts";
import { composerCadenceError } from "../../../features/ingestion-sources/model/pull-cadence.ts";
import { PullCadenceField } from "../../../features/ingestion-sources/ui/elements/pull-cadence-field.tsx";
import { SourceTypeIconGlyph } from "../../../features/ingestion-sources/ui/elements/source-type-icon-glyph.tsx";
import { TraceDestinationField } from "../../../features/ingestion-sources/ui/elements/trace-destination-field.tsx";
import { EnterpriseOttlEditor as OttlEditor } from "../../../features/ottl/ui/sections/ottl-editor.connected.tsx";
import type { DestinationContext, Source } from "./ingestion-source-forms.ts";
import { AdvancedSettingsGroup, ParserConfigFields } from "./parser-config-fields.tsx";
import {
  buildEditSubmission,
  type EditSubmission,
  isEditablePullSource,
  seedComposerParserConfig,
  seedPullSchedule,
} from "./source-submission.ts";

/** The edit form's starting values, read off the stored row. */
function seedSourceEditForm(source: Source) {
  const parser = (source.parserConfig as Record<string, unknown>) ?? {};
  const raw = parser.ottlStatements;
  return {
    name: source.name,
    description: source.description ?? "",
    statements: Array.isArray(raw) ? raw.filter((s): s is string => typeof s === "string") : [],
    parserConfig: seedComposerParserConfig({
      sourceType: source.sourceType as SourceType,
      storedParserConfig: parser,
    }),
    // The column first, because it is the one the lifecycle runs on; the
    // adapter's copy inside parserConfig is a duplicate. See `seedPullSchedule`.
    pullSchedule: seedPullSchedule({
      pullSchedule: source.pullSchedule,
      storedParserConfig: parser,
    }),
  };
}

/**
 * The edit form's local state, seeded from the row each time the drawer opens
 * on a different source, including the trace destination.
 *
 * Split out from the drawer because seeding is the half with the reasoning in
 * it — which fields the row can answer, and which the DTO deliberately cannot
 * — while the drawer below is chrome. Keeping them in one function meant every
 * read of the markup scrolled past the seeding rules first.
 */
function useSourceEditForm(source: Source | null) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [statements, setStatements] = useState<string[]>([]);
  const [parserConfig, setParserConfig] = useState<Record<string, string>>({});
  const [pullSchedule, setPullSchedule] = useState("");
  /**
   * `undefined` until the admin touches the picker — see
   * {@link buildEditSubmission} for why an untouched destination must not be
   * echoed back to a server that would re-validate it.
   */
  const [destination, setDestination] = useState<string | null | undefined>(undefined);

  // Seeded once per source id, during render: a re-render that hands back an
  // equal row must not discard what the admin has typed since the drawer opened.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (!source && seededFor !== null) setSeededFor(null);
  if (source && source.id !== seededFor) {
    const seed = seedSourceEditForm(source);
    setSeededFor(source.id);
    setName(seed.name);
    setDescription(seed.description);
    setDestination(undefined);
    setStatements(seed.statements);
    setParserConfig(seed.parserConfig);
    setPullSchedule(seed.pullSchedule);
  }

  return {
    name,
    setName,
    description,
    setDescription,
    statements,
    setStatements,
    parserConfig,
    setParserConfig,
    pullSchedule,
    setPullSchedule,
    destination,
    setDestination,
  };
}

/** The two fields every source has, whatever its type. */
function SourceIdentityFields({
  name,
  onNameChange,
  description,
  onDescriptionChange,
}: {
  name: string;
  onNameChange: (next: string) => void;
  description: string;
  onDescriptionChange: (next: string) => void;
}) {
  return (
    <>
      <VStack align="stretch" gap={1}>
        <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
          Display name
        </Text>
        <Input size="sm" value={name} onChange={(e) => onNameChange(e.target.value)} />
      </VStack>
      <VStack align="stretch" gap={1}>
        <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
          Description (optional)
        </Text>
        <Textarea
          size="sm"
          rows={2}
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
        />
      </VStack>
    </>
  );
}

/**
 * Whether the backfill start has stopped being editable for this source.
 *
 * Only the USAGE cursor is one-way. The cost cursor binds `startingAt` into
 * its own identity, so moving the start mints a new identity, discards the
 * cursor and re-reads from the configured date — the deliberate repair lever
 * for a source whose early history is wrong (see `queryIdentity` and
 * `staleCursorRestart` in anthropicAdmin.puller.ts). Locking it for cost would
 * hide the one control that fixes those figures behind archive + recreate.
 *
 * A source that has never pulled holds no cursor to contradict, so nothing is
 * locked yet whatever the report.
 */
export function isBackfillStartLocked({
  hasPulled,
  report,
}: {
  hasPulled: boolean;
  report: string | undefined;
}): boolean {
  return hasPulled && report === "usage";
}

/**
 * Which adapter fields the form shows but refuses to change.
 *
 * `startingAt` locks because the usage cursor never rewinds, so an edited
 * start would be accepted and then ignored. `report` locks for a harder
 * reason: the two Anthropic reports price the same spend twice, the adapter
 * says "never both", and switching one that has already run leaves the old
 * report's events in place while the new one replays the same period beside
 * them. The service refuses that change too — this is the form declining to
 * offer what the server would reject, not the guarantee itself.
 */
export function lockedParserKeys({
  hasPulled,
  report,
  sourceType,
}: {
  hasPulled: boolean;
  report: string | undefined;
  sourceType?: SourceType;
}): string[] {
  const keys: string[] = [];
  if (isEnvironmentLocked({ hasPulled, sourceType })) keys.push("environmentUrl");
  if (isBackfillStartLocked({ hasPulled, report })) keys.push("startingAt");
  if (hasPulled && typeof report === "string" && report.length > 0) {
    keys.push("report");
  }
  return keys;
}

/**
 * What the edit drawer has to explain about settings the adapter can no longer
 * change, in the order it explains them.
 *
 * These were three paragraphs printed in the drawer body above the fields they
 * describe, which pushed the form below the fold on every source that had
 * pulled and were scrolled past by everyone who had read them once. They go
 * behind a (i) beside the title instead — the same place the create composer
 * already keeps its setup prose. See `dev/docs/best_practices/copywriting.md`.
 *
 * Empty for a source with nothing locked, and the header renders no marker at
 * all in that case: a (i) opening onto nothing is a promise of an explanation
 * that is not there.
 *
 * At most two ever apply. The report locks for any pulled source; of the other
 * two, the usage cursor never rewinds so its start is fixed, while the cost
 * cursor binds `startingAt` into its own identity so moving the start is the
 * deliberate repair lever for figures that are wrong. A fixed start and a
 * start worth moving are the two halves of one condition, and the report
 * decides which half this admin is looking at.
 */
export function editSourceNotes({
  hasPulled,
  report,
  sourceType,
}: {
  hasPulled: boolean;
  report: string | undefined;
  sourceType?: SourceType;
}): string[] {
  const notes: string[] = [];
  if (isEnvironmentLocked({ hasPulled, sourceType })) {
    notes.push(
      "The environment is fixed once a source has read conversations from it. To read another environment, archive this source and create a new one.",
    );
  }
  if (lockedParserKeys({ hasPulled, report }).includes("report")) {
    notes.push(
      "The report is fixed once a source has pulled: usage and cost describe the same spend, so recording both for one source would count it twice. To switch, archive this source and create a new one.",
    );
  }
  if (isBackfillStartLocked({ hasPulled, report })) {
    notes.push(
      "The start date is fixed once a source has pulled: the cursor has already moved past it and never rewinds. To re-read older data, archive this source and create a new one with an earlier start.",
    );
  }
  if (hasPulled && report === "cost") {
    notes.push(
      "Moving the start date re-reads cost history from the new date and restates the figures already recorded for that window.",
    );
  }
  return notes;
}

/** A conversation source's cursor is a position in one environment's history. */
function isEnvironmentLocked({
  hasPulled,
  sourceType,
}: {
  hasPulled: boolean;
  sourceType?: SourceType;
}): boolean {
  return hasPulled && sourceType === "copilot_studio_dataverse";
}

/**
 * The adapter half of the edit form: the pull config fields plus the cadence,
 * rendered only for a source type the form knows how to rebuild.
 */
function PullConfigEditFields({
  sourceType,
  parserConfig,
  onParserConfigChange,
  pullSchedule,
  onPullScheduleChange,
  hasPulled,
  destinationField,
}: {
  sourceType: SourceType;
  parserConfig: Record<string, string>;
  onParserConfigChange: (next: Record<string, string>) => void;
  pullSchedule: string;
  onPullScheduleChange: (next: string) => void;
  /** Whether the source already holds a poller cursor. */
  hasPulled: boolean;
  /**
   * The destination picker, when this source type routes conversations, so it
   * joins the cadence in the one Advanced group instead of opening a second.
   */
  destinationField?: ReactNode;
}) {
  const lockedKeys = lockedParserKeys({
    hasPulled,
    report: parserConfig.report,
    sourceType,
  });
  return (
    <ParserConfigFields
      sourceType={sourceType}
      values={parserConfig}
      onChange={onParserConfigChange}
      mode="edit"
      readOnlyKeys={lockedKeys.length > 0 ? lockedKeys : undefined}
      // Same group, same order as the create drawer: the two forms edit the
      // same source and must not disagree about where a setting lives.
      advancedExtras={
        <>
          <PullCadenceField
            sourceType={sourceType}
            value={pullSchedule}
            onChange={onPullScheduleChange}
          />
          {destinationField}
        </>
      }
    />
  );
}

/**
 * Edit a previously-created IngestionSource: name, description, OTTL, and —
 * for a pull source the form knows how to rebuild — the adapter configuration
 * and cadence the poller actually runs on.
 *
 * Shared by the source list and the source detail page, so the two cannot
 * drift into offering different edits of the same row.
 *
 * Source type is immutable after create (changing it would invalidate the
 * upstream's running configuration); admins who need to change it archive +
 * recreate.
 */
/**
 * Whether Save should refuse the click.
 *
 * The same two conditions the create drawer gates on, so the two cannot
 * disagree about what is worth submitting. The cadence half only applies to a
 * source whose adapter config this form rebuilds — a push-mode source has no
 * schedule for the field to have marked invalid.
 *
 * The server refuses an invalid cron regardless (`assertPullSchedule`, on the
 * update path), so this is not what keeps a bad schedule out of the column.
 * It is what stops the form submitting a value it has already told the admin
 * is wrong.
 */
export function isEditSaveBlocked({
  name,
  sourceType,
  pullSchedule,
}: {
  name: string;
  sourceType: SourceType | undefined;
  pullSchedule: string;
}): boolean {
  if (!name.trim()) return true;
  if (!isEditablePullSource(sourceType)) return false;
  return composerCadenceError({ sourceType, pullSchedule }) !== null;
}

/** Why Save is off, in words; `isEditSaveBlocked` keeps deciding whether it is. */
function editSaveBlockedReason(input: {
  name: string;
  sourceType: SourceType | undefined;
  pullSchedule: string;
}): string | undefined {
  if (!input.name.trim()) return "Give the source a display name";
  if (isEditSaveBlocked(input)) return "Fix the pull schedule to save";
  return undefined;
}

export function SourceEditDrawer({
  organizationId,
  destinationCtx,
  source,
  onClose,
  onSubmit,
  isPending,
  refusal,
}: {
  organizationId: string;
  /**
   * The teams and projects a destination can be picked from, passed in rather
   * than derived here so this drawer and the create composer offer the same
   * list — see `useDestinationContext` in `ingestion-source-forms.ts`.
   */
  destinationCtx: DestinationContext;
  source: Source | null;
  onClose: () => void;
  onSubmit: (input: EditSubmission) => void;
  isPending: boolean;
  /** The save's failure; a parser refusal is drawn onto the statements it names. */
  refusal?: unknown;
}) {
  const isOpen = !!source;
  const form = useSourceEditForm(source);
  const toaster = useGovernanceToaster();

  // The DTO carries `sourceType` as a bare string; every lookup below is keyed
  // by `SourceType`, and an unknown value simply misses every table rather
  // than throwing — which is the behaviour we want for a row written by a
  // newer deploy than the one serving this page.
  const sourceType = source?.sourceType as SourceType | undefined;

  // A source holding no cursor has its backfill start genuinely still in play.
  // Once one exists the usage cursor never rewinds, so the setting would be
  // accepted and then ignored — it is shown read-only rather than offered as a
  // lie. This reads the row's own answer rather than inferring one from
  // `status`, which is wrong in both directions: a pull that succeeded with
  // zero events leaves the source `awaiting_first_event` holding a cursor, and
  // a source disabled before its first run never minted one.
  const hasPulled = source?.hasPollerCursor ?? false;

  // Misses for a type this deploy has no entry for — a row written by a newer
  // one — so the title falls back to the generic word rather than to
  // "Edit undefined".
  const editLabel = (sourceType && SOURCE_TYPE_LABEL[sourceType]) ?? "source";
  const lockNotes = editSourceNotes({
    hasPulled,
    report: form.parserConfig.report,
    sourceType,
  });

  if (!source) return null;

  const handleSubmit = () => {
    const submission = buildEditSubmission({
      organizationId,
      source,
      name: form.name,
      description: form.description,
      parserConfig: form.parserConfig,
      ottlStatements: form.statements,
      pullSchedule: form.pullSchedule,
      toaster,
      destination: form.destination,
    });
    // null is a form that is not saveable — an empty name, or a pull field the
    // adapter cannot parse, which has already told the admin which one.
    if (!submission) return;
    onSubmit(submission);
  };

  const saveBlockedReason = editSaveBlockedReason({
    name: form.name,
    sourceType,
    pullSchedule: form.pullSchedule,
  });

  return (
    <Drawer
      open={isOpen}
      onClose={onClose}
      title={`Edit ${editLabel}`}
      icon={
        sourceType ? (
          <SourceTypeIconGlyph sourceType={sourceType} size="24px" testId="source-type-icon" />
        ) : undefined
      }
      headerTools={
        lockNotes.length > 0 ? (
          <FieldInfoTooltip description={lockNotes.join(" ")} testId="edit-source-notes" />
        ) : null
      }
      footer={{
        cancel: { onClick: onClose },
        primaryAction: {
          label: "Save changes",
          onClick: handleSubmit,
          loading: isPending,
          disabledReason: saveBlockedReason,
        },
      }}
    >
      <SourceEditBody
        form={form}
        source={source}
        sourceType={sourceType}
        hasPulled={hasPulled}
        organizationId={organizationId}
        destinationCtx={destinationCtx}
        refusal={refusal}
      />
    </Drawer>
  );
}

/**
 * The fields an edit drawer shows, in order. Split from the drawer because the
 * drawer above is a shell — open state, submit gate, footer — while this is the
 * part that decides what an admin can actually change about a source, and which
 * of those fields the source's type even offers.
 */
function SourceEditBody({
  form,
  source,
  sourceType,
  hasPulled,
  organizationId,
  destinationCtx,
  refusal,
}: {
  form: ReturnType<typeof useSourceEditForm>;
  source: Source;
  sourceType: SourceType | undefined;
  hasPulled: boolean;
  organizationId: string;
  destinationCtx: DestinationContext;
  refusal?: unknown;
}) {
  // Derived here rather than passed in: `isEditablePullSource` is a type guard,
  // and narrowing `sourceType` is what lets the pull fields below take it as a
  // `SourceType` instead of re-asserting one.
  const isPullMode = isEditablePullSource(sourceType);
  // The row menu offers Rotate secret only for these (needsIngestSecret).
  const hasRotatableSecret = !!sourceType && needsIngestSecret({ sourceType });
  // Read here rather than left to the field's own early return, because the
  // Advanced group has to know whether it holds anything before it offers
  // itself — a disclosure that opens onto an empty box is worse than none.
  const offersDestination = routesConversations(source.sourceType as SourceType);

  const destinationField = offersDestination ? (
    <TraceDestinationField
      sourceType={source.sourceType as SourceType}
      // Both props describe `value`, so both have to move together. An
      // untouched picker shows the stored destination and the archived
      // notice that describes it; the moment a replacement is picked, the
      // flag stops applying — it described the project that has just been
      // replaced, not the one now on screen. Left true, the picker seeds
      // empty (`ScopeChipPicker.tsx:759` is fully controlled), so the admin
      // picks a project, sees nothing selected under an unchanged warning,
      // and concludes the control is dead.
      value={form.destination === undefined ? (source.traceProjectId ?? null) : form.destination}
      onChange={form.setDestination}
      mode="edit"
      destinationArchived={form.destination === undefined && (source.traceProjectArchived ?? false)}
      {...destinationCtx}
    />
  ) : null;

  return (
    <VStack align="stretch" gap={3}>
      <SourceIdentityFields
        name={form.name}
        onNameChange={form.setName}
        description={form.description}
        onDescriptionChange={form.setDescription}
      />

      {isPullMode ? (
        <PullConfigEditFields
          sourceType={sourceType}
          parserConfig={form.parserConfig}
          onParserConfigChange={form.setParserConfig}
          pullSchedule={form.pullSchedule}
          onPullScheduleChange={form.setPullSchedule}
          hasPulled={hasPulled}
          destinationField={destinationField}
        />
      ) : (
        // A source type this form builds no adapter config for still has a
        // destination to place, and no parser fields to hang the group off.
        destinationField && <AdvancedSettingsGroup>{destinationField}</AdvancedSettingsGroup>
      )}

      <OttlEditor
        organizationId={organizationId}
        sourceType={source.sourceType}
        statements={form.statements}
        onChange={form.setStatements}
        enabled={isOttlEnabledSourceType(source.sourceType)}
        refusal={refusal}
      />

      <Text fontSize="xs" color="fg.muted">
        {hasRotatableSecret
          ? "Source type and ingest secret are immutable after create. Use “Rotate secret” for the secret; archive + recreate to change source type."
          : "Source type is immutable after create: archive and recreate to change it."}
      </Text>
    </VStack>
  );
}
