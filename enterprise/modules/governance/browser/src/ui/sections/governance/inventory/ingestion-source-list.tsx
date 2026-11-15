// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { SkeletonRows } from "@langwatch/design-system/skeletons";
import { HandledErrorAlert } from "@langwatch/error-views";
import { Plug } from "lucide-react";
import type { ReactNode } from "react";

import { IngestionSourcesTable } from "../../../../features/ingestion-sources/ingestion-sources-table.tsx";
import { GovernanceEmptyState } from "../../../../ui/elements/governance-empty-state.tsx";
import { PermissionRequiredNotice } from "../../../../ui/elements/permission-required-notice.tsx";
import type { Source } from "../ingestion-source-forms.ts";

type IngestionSourceListProps = {
  isSample?: boolean;
  canRead: boolean;
  canManage: boolean;
  isLoading: boolean;
  error: unknown;
  sources: Source[] | undefined;
  rotatingId: string | null;
  archivingId: string | null;
  onEdit: (id: string) => void;
  onRotate: (id: string) => void;
  onArchive: (id: string) => void;
  /**
   * The page header's OWN create control, rendered a second time inside the
   * empty state. Not a second control in the sense the create-on-top rule
   * forbids: same component, so same label, same weight and same flow. This is
   * deliberately not the `addControl` slot that used to sit in the table's
   * header — that one was a differently-worded outline button and is gone.
   */
  createAction?: ReactNode;
};

/** What the list says when the viewer may read it and no source exists yet. */
function NoSourcesConnected({
  canManage,
  createAction,
}: {
  canManage: boolean;
  createAction?: ReactNode;
}) {
  return (
    <GovernanceEmptyState
      testId="ingestion-sources-empty"
      icon={Plug}
      headline="No sources connected yet"
      description={
        canManage
          ? "A source is where this organization's AI usage is read from. Connect one and its events start arriving here."
          : "A source is where this organization's AI usage is read from. Once someone connects one, its events arrive here."
      }
      action={createAction}
    />
  );
}

/**
 * The source list: what the viewer may read, what went wrong when it could
 * not be read, the connectors header with its add control, the table, and
 * the note naming the grant that unlocks the writes.
 */
export function IngestionSourceList({
  isSample = false,
  canRead,
  canManage,
  isLoading,
  error,
  sources,
  rotatingId,
  archivingId,
  onEdit,
  onRotate,
  onArchive,
  createAction,
}: IngestionSourceListProps) {
  // Only claim "none connected" when we actually know: on a load failure the
  // alert below says what went wrong instead, and an empty table read off an
  // empty `?? []` would tell an admin their entire ingest fleet is gone when
  // all that happened was a 403.
  //
  // THE "CONNECTORS · N SOURCES · N ACTIVE" HEADING THAT USED TO SIT HERE IS
  // GONE. Both of its figures are now in the page's resume strip above the tab
  // strip, beside the other two panes' counts, so a reader learns them without
  // opening this pane. Saying them twice on one screen was the redundancy the
  // strip was added to remove.
  const knowsFleet = !error && !isLoading && sources !== undefined;
  return (
    <>
      {!canRead && (
        <PermissionRequiredNotice
          permission="ingestionSources:view"
          detail="The source list stays hidden until then."
        />
      )}

      {isLoading && <SkeletonRows rows={5} label="Loading ingestion sources" />}

      {error ? (
        <HandledErrorAlert error={error} fallbackTitle="Couldn't load ingestion sources" />
      ) : null}

      {/* A grey sentence used to sit here, which told a reader the state and
          left them in it. The way out is the page header's own Add source,
          rendered again here rather than described: a sentence naming a button
          goes stale the moment the button is renamed, and nothing checks
          prose. Same component, so one label, one weight, one flow. */}
      {canRead && knowsFleet && sources.length === 0 && (
        <NoSourcesConnected canManage={canManage} createAction={createAction} />
      )}

      {canRead && knowsFleet && sources.length > 0 && (
        <IngestionSourcesTable
          sources={sources}
          isSample={isSample}
          canManage={canManage}
          rotatingId={rotatingId}
          archivingId={archivingId}
          onEdit={onEdit}
          onRotate={onRotate}
          onArchive={onArchive}
        />
      )}

      {canRead && !canManage && !isSample && (
        <PermissionRequiredNotice
          permission="ingestionSources:manage"
          detail="You can read the sources. Adding, editing, rotating a secret, and archiving need this grant."
        />
      )}
    </>
  );
}
