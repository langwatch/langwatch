/**
 * `/dashboards/<id>`: a board opened by id at the organization level (ADR-002, decisions 3, 4).
 * Every board runs the project board screen in the project it opens in, so project-routed reads
 * and writes work unchanged. `/dashboards/new` and the board it becomes skip the read (AC162).
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import { UiPageLoading, UiPageNotFound } from "@langwatch/browser/page-fallbacks";
import { Button, VStack } from "@langwatch/design-system/primitives";
import { HandledErrorAlert } from "@langwatch/error-views";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import { useEffect } from "react";

import { InProject } from "../../../../behavior/in-project.tsx";
import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { holdDraftInDashboards, useDraftFrame } from "../../behavior/use-draft-board.ts";
import { useOrganizationBoard } from "../../behavior/use-organization-board.ts";
import { useStoreProject } from "../../behavior/use-store-project.ts";
import { DRAFT_SEGMENT } from "../../model/boards.ts";
import { OrganizationBoardUnavailable } from "../blocks/board-unavailable.tsx";
import { Board } from "./dashboard-board.screen.tsx";

export default function OrganizationBoardScreen() {
  const dashboardId = useAnalyticsHost().route().params.dashboardId;
  const draft = useDraftFrame();
  // The board the draft became keeps the draft's screen while the address moves to it.
  const isDraft = dashboardId === DRAFT_SEGMENT || (draft.project && dashboardId === draft.savedId);
  if (isDraft) return <DraftBoard />;
  return <ResolvedBoard />;
}

/** A new board, in the store project the dialog picked, or, opened afresh, the member's own. */
function DraftBoard() {
  const draft = useDraftFrame();
  const { storeProject, isLoading } = useStoreProject({ enabled: !draft.project });
  const project = draft.project ?? storeProject;
  useEffect(() => {
    if (storeProject && !draft.project) holdDraftInDashboards(storeProject);
  }, [storeProject, draft.project]);
  if (!project) return isLoading ? <UiPageLoading /> : <UiPageNotFound />;
  return (
    <InProject key={project.id} project={project}>
      <Board />
    </InProject>
  );
}

function ResolvedBoard() {
  const { place, isLoading, loadError, retry } = useOrganizationBoard();
  const code = readHandledError(loadError)?.code;

  if (code === "dashboards_not_enabled") return <UiPageNotFound />;
  if (code === "dashboard_not_found") return <OrganizationBoardUnavailable />;
  if (loadError) {
    // A failed read never reads as deleted: the board may well be there.
    return (
      <VStack align="start" gap={2} padding={6}>
        <HandledErrorAlert error={loadError} fallbackTitle="Couldn't load this dashboard." />
        <Button size="xs" variant="outline" onClick={retry}>
          Retry
        </Button>
      </VStack>
    );
  }
  if (isLoading || !place) return <UiPageLoading />;
  if (place.kind === "unavailable") return <OrganizationBoardUnavailable />;
  return (
    <InProject key={place.project.id} project={place.project}>
      <Board />
    </InProject>
  );
}
