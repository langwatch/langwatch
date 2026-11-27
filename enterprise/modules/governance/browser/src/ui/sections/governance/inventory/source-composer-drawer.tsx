// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Drawer } from "@langwatch/design-system/drawer";
import { FieldInfoTooltip } from "@langwatch/design-system/field-info-tooltip";
import { Input, Text, Textarea, VStack } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

import {
  isOttlEnabledSourceType,
  routesConversations,
  SOURCE_TYPE_OPTIONS,
} from "../../../../features/ingestion-sources/model/ingestion-source-catalog.ts";
import {
  composerCadenceError,
  recommendedPullSchedule,
} from "../../../../features/ingestion-sources/model/pull-cadence.ts";
import { PullCadenceField } from "../../../../features/ingestion-sources/ui/elements/pull-cadence-field.tsx";
import { SourceTypeIconGlyph } from "../../../../features/ingestion-sources/ui/elements/source-type-icon-glyph.tsx";
import { TraceDestinationField } from "../../../../features/ingestion-sources/ui/elements/trace-destination-field.tsx";
import { EnterpriseOttlEditor as OttlEditor } from "../../../../features/ottl/ui/sections/ottl-editor.connected.tsx";
import type { DestinationContext } from "../ingestion-source-forms.ts";
import { AgentListingTest } from "./agent-listing-test.tsx";
import { agentListingTestInput, isCloudAgentSourceType } from "./cloud-agent-pull-config.ts";
import { cloudAgentCustomControl } from "./cloud-agent-source-controls.tsx";
import { ParserConfigFields } from "./parser-config-fields.tsx";
import type { ComposerState } from "./source-composer-state.ts";

/**
 * What the create drawer puts behind "Advanced": the two settings an admin
 * rarely changes, and both safe to leave closed. Cadence arrives holding the
 * recommended schedule for the source type, and a source with no destination
 * ingests normally — it simply routes no conversations onward until someone
 * says where.
 *
 * Returns `undefined` rather than an empty fragment for a type that offers
 * neither, because an element that renders nothing still counts as content to
 * the group, and would leave a push source's drawer showing an "Advanced"
 * button that opens onto an empty box.
 */
function composerAdvancedExtras({
  composer,
  setComposer,
  destinationCtx,
}: {
  composer: ComposerState;
  setComposer: (next: ComposerState) => void;
  destinationCtx: DestinationContext;
}): ReactNode | undefined {
  // The same two predicates the fields themselves gate on, read here so the
  // group knows whether it has anything to hold before it offers itself.
  const offersCadence = recommendedPullSchedule(composer.sourceType) !== null;
  const offersDestination = routesConversations(composer.sourceType);
  if (!offersCadence && !offersDestination) return undefined;
  return (
    <>
      {offersCadence && (
        <PullCadenceField
          sourceType={composer.sourceType}
          value={composer.pullSchedule}
          onChange={(pullSchedule) => setComposer({ ...composer, pullSchedule })}
        />
      )}
      {offersDestination && (
        <TraceDestinationField
          sourceType={composer.sourceType}
          value={composer.traceProjectId}
          onChange={(traceProjectId) => setComposer({ ...composer, traceProjectId })}
          mode="create"
          {...destinationCtx}
        />
      )}
    </>
  );
}

/**
 * What the closed Advanced group owes the outside: one line saying where this
 * source's conversations will go.
 *
 * The destination picker sits inside the group, so an admin who never opens it
 * never reads what it says about leaving the destination unset — and a source
 * created that way routes its conversations nowhere. The default is fine; the
 * silence about it is not, so the outcome is stated where the admin is
 * already looking.
 *
 * Only for types that route conversations. On a source that produces none,
 * a line about where conversations land describes a decision its adapter
 * never makes.
 */
function ComposerDestinationHint({
  composer,
  destinationCtx,
}: {
  composer: ComposerState;
  destinationCtx: DestinationContext;
}) {
  if (!routesConversations(composer.sourceType)) return null;
  // Silent until a destination is picked: the field tooltips already say
  // what the silent default means, so the drawer only speaks when it has a
  // choice to confirm.
  if (!composer.traceProjectId) return null;
  // Named from the same list the picker offers, so the line and the control
  // cannot disagree about which project was chosen.
  const chosen = destinationCtx.availableProjects.find(
    (project) => project.id === composer.traceProjectId,
  );
  return (
    <Text fontSize="xs" color="fg.muted" data-testid="composer-destination-hint">
      {`Conversations will land in ${chosen?.name ?? "the project picked under Advanced"}.`}
    </Text>
  );
}

type SourceComposerDrawerProps = {
  isOpen: boolean;
  organizationId: string;
  destinationCtx: DestinationContext;
  composer: ComposerState;
  setComposer: (next: ComposerState) => void;
  /** Required fields a refused save found empty, marked on the form itself. */
  invalidFieldKeys: readonly string[];
  isPending: boolean;
  /** The save's failure; a parser refusal is drawn onto the statements it names. */
  refusal?: unknown;
  onSubmit: () => void;
  onClose: () => void;
};

/** The display name and description, the two fields every new source asks for. */
function ComposerIdentityFields({
  composer,
  setComposer,
}: Pick<SourceComposerDrawerProps, "composer" | "setComposer">) {
  return (
    <>
      <VStack align="stretch" gap={1}>
        <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
          Display name
        </Text>
        <Input
          size="sm"
          value={composer.name}
          onChange={(e) => setComposer({ ...composer, name: e.target.value })}
          placeholder="Display name for this source"
        />
      </VStack>
      <VStack align="stretch" gap={1}>
        <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
          Description (optional)
        </Text>
        <Textarea
          size="sm"
          rows={2}
          value={composer.description}
          onChange={(e) => setComposer({ ...composer, description: e.target.value })}
          // Asks in the same shape as the display name directly above
          // it. The old prompt asked for two particular facts and used a
          // word ("fleet") that appears nowhere else an admin can see.
          placeholder="Description for this source"
        />
      </VStack>
    </>
  );
}

/** Why Create is off, in words, or undefined when the draft may be submitted. */
function composerCreateBlockedReason(composer: ComposerState): string | undefined {
  return composer.name.trim()
    ? (composerCadenceError({
        sourceType: composer.sourceType,
        pullSchedule: composer.pullSchedule,
      }) ?? undefined)
    : "Give the source a display name";
}

export function SourceComposerDrawer({
  isOpen,
  organizationId,
  destinationCtx,
  composer,
  setComposer,
  invalidFieldKeys,
  isPending,
  refusal,
  onSubmit,
  onClose,
}: SourceComposerDrawerProps) {
  const meta = SOURCE_TYPE_OPTIONS.find((o) => o.value === composer.sourceType);
  const advancedExtras = composerAdvancedExtras({ composer, setComposer, destinationCtx });
  // The type was picked from the Add source menu, which is where the plan
  // gate lives (see gatedSourceTypeOptions) — the composer is committed to
  // it. Changing type means closing and picking again, exactly like the
  // model-provider drawer.
  const createBlockedReason = composerCreateBlockedReason(composer);
  return (
    <Drawer
      open={isOpen}
      onClose={onClose}
      title={`Add ${meta?.label ?? "ingestion source"}`}
      icon={<SourceTypeIconGlyph sourceType={composer.sourceType} size="24px" />}
      headerTools={
        meta?.blurb ? (
          <FieldInfoTooltip description={meta.blurb} testId="source-type-blurb" />
        ) : null
      }
      footer={{
        cancel: { onClick: onClose },
        primaryAction: {
          label: "Create source",
          onClick: onSubmit,
          loading: isPending,
          disabledReason: createBlockedReason,
        },
      }}
    >
      <VStack align="stretch" gap={3}>
        <ComposerIdentityFields composer={composer} setComposer={setComposer} />

        <ParserConfigFields
          sourceType={composer.sourceType}
          values={composer.parserConfig}
          onChange={(parserConfig) => setComposer({ ...composer, parserConfig })}
          invalidKeys={invalidFieldKeys}
          advancedExtras={advancedExtras}
          renderCustomControl={cloudAgentCustomControl({ organizationId })}
        />

        {isCloudAgentSourceType(composer.sourceType) && (
          <AgentListingTest
            organizationId={organizationId}
            target={{ kind: "draft", input: agentListingTestInput(composer) }}
          />
        )}

        <ComposerDestinationHint composer={composer} destinationCtx={destinationCtx} />

        <OttlEditor
          organizationId={organizationId}
          sourceType={composer.sourceType}
          statements={composer.ottlStatements}
          onChange={(ottlStatements) => setComposer({ ...composer, ottlStatements })}
          enabled={isOttlEnabledSourceType(composer.sourceType)}
          refusal={refusal}
        />
      </VStack>
    </Drawer>
  );
}
