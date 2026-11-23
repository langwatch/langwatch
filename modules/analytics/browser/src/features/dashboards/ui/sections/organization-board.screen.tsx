/**
 * `/dashboards/<id>`: a board opened by id at the organization level (ADR-002, decisions 3 and
 * 4). A Project board goes to its project's address; any other runs the project board screen in
 * the project it opens in, so every project-routed read and write works unchanged.
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import { UiPageLoading, UiPageNotFound } from "@langwatch/browser/page-fallbacks";
import { Button, VStack } from "@langwatch/design-system/primitives";
import { HandledErrorAlert } from "@langwatch/error-views";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import { useEffect } from "react";

import { InProject } from "../../../../behavior/in-project.tsx";
import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { useOrganizationBoard } from "../../behavior/use-organization-board.ts";
import { OrganizationBoardUnavailable } from "../blocks/board-unavailable.tsx";
import { Board } from "./dashboard-board.screen.tsx";

function Redirect({ to }: { to: string }) {
  const host = useAnalyticsHost();
  useEffect(() => {
    host.navigate(to, { replace: true });
  }, [host, to]);
  return <UiPageLoading />;
}

export default function OrganizationBoardScreen() {
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
  if (place.kind === "redirect") return <Redirect to={place.to} />;
  if (place.kind === "unavailable") return <OrganizationBoardUnavailable />;
  return (
    <InProject project={place.project}>
      <Board atOrganization />
    </InProject>
  );
}
