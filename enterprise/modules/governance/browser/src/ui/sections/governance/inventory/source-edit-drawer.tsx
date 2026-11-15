// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Drawer } from "@langwatch/design-system/drawer";
import { FieldInfoTooltip } from "@langwatch/design-system/field-info-tooltip";

import { useGovernanceToaster } from "../../../../behavior/governance-feedback.ts";
import {
  SOURCE_TYPE_LABEL,
  type SourceType,
} from "../../../../features/ingestion-sources/model/ingestion-source-catalog.ts";
import { SourceTypeIconGlyph } from "../../../../features/ingestion-sources/ui/elements/source-type-icon-glyph.tsx";
import type { DestinationContext, Source } from "../ingestion-source-forms.ts";
import { SourceEditBody } from "./source-edit-body.tsx";
import { editSaveBlockedReason, editSourceNotes } from "./source-edit-rules.ts";
import { buildEditSubmission, type EditSubmission } from "./source-submission.ts";
import { useSourceEditForm } from "./use-source-edit-form.ts";

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
