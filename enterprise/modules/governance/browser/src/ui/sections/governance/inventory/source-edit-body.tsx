// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Input, Text, Textarea, VStack } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

import {
  isOttlEnabledSourceType,
  needsIngestSecret,
  routesConversations,
  type SourceType,
} from "../../../../features/ingestion-sources/model/ingestion-source-catalog.ts";
import { PullCadenceField } from "../../../../features/ingestion-sources/ui/elements/pull-cadence-field.tsx";
import { TraceDestinationField } from "../../../../features/ingestion-sources/ui/elements/trace-destination-field.tsx";
import { EnterpriseOttlEditor as OttlEditor } from "../../../../features/ottl/ui/sections/ottl-editor.connected.tsx";
import type { DestinationContext, Source } from "../ingestion-source-forms.ts";
import { AdvancedSettingsGroup } from "./advanced-settings-group.tsx";
import { AgentListingTest } from "./agent-listing-test.tsx";
import { isCloudAgentSourceType } from "./cloud-agent-pull-config.ts";
import { cloudAgentCustomControl } from "./cloud-agent-source-controls.tsx";
import { ParserConfigFields } from "./parser-config-fields.tsx";
import { lockedParserKeys } from "./source-edit-rules.ts";
import { isEditablePullSource } from "./source-submission.ts";
import type { useSourceEditForm } from "./use-source-edit-form.ts";

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
  organizationId,
}: {
  organizationId: string;
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
      renderCustomControl={cloudAgentCustomControl({ organizationId })}
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

type SourceEditBodyProps = {
  form: ReturnType<typeof useSourceEditForm>;
  source: Source;
  sourceType: SourceType | undefined;
  hasPulled: boolean;
  organizationId: string;
  destinationCtx: DestinationContext;
  refusal?: unknown;
};

/** The trace destination picker, or null for a type that routes no conversations. */
function editDestinationField({
  form,
  source,
  destinationCtx,
}: Pick<SourceEditBodyProps, "form" | "source" | "destinationCtx">): ReactNode {
  // Read here rather than left to the field's own early return, because the
  // Advanced group has to know whether it holds anything before it offers
  // itself — a disclosure that opens onto an empty box is worse than none.
  const offersDestination = routesConversations(source.sourceType as SourceType);

  return offersDestination ? (
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
}

/**
 * The fields an edit drawer shows, in order. Split from the drawer because
 * `SourceEditDrawer` (`source-edit-drawer.tsx`) is a shell — open state, submit
 * gate, footer — while this decides what an admin can change about a source.
 */
export function SourceEditBody({
  form,
  source,
  sourceType,
  hasPulled,
  organizationId,
  destinationCtx,
  refusal,
}: SourceEditBodyProps) {
  // Derived here rather than passed in: `isEditablePullSource` is a type guard,
  // and narrowing `sourceType` is what lets the pull fields below take it as a
  // `SourceType` instead of re-asserting one.
  const isPullMode = isEditablePullSource(sourceType);
  // The row menu offers Rotate secret only for these (needsIngestSecret).
  const hasRotatableSecret = !!sourceType && needsIngestSecret({ sourceType });
  const destinationField = editDestinationField({ form, source, destinationCtx });

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
          organizationId={organizationId}
        />
      ) : (
        // A source type this form builds no adapter config for still has a
        // destination to place, and no parser fields to hang the group off.
        destinationField && <AdvancedSettingsGroup>{destinationField}</AdvancedSettingsGroup>
      )}

      {isCloudAgentSourceType(source.sourceType) && (
        <AgentListingTest
          organizationId={organizationId}
          target={{ kind: "saved", sourceId: source.id }}
        />
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
