import { IconButton, Link } from "@chakra-ui/react";
import { useRouter } from "next/router";
import type { CellContext } from "@tanstack/react-table";
import type { ScenarioRunRow } from "../types";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

/**
 * Actions cell with icon button to open the run in a dedicated page
 */
export function ActionsCell({ row }: CellContext<ScenarioRunRow, unknown>) {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const projectSlug = project?.slug ?? "";
  const data = row.original;

  // Build the URL to the scenario run page
  const runUrl = `/${projectSlug}/simulations/${data.scenarioSetId}/${data.batchRunId}/${data.scenarioRunId}`;

  return (
    <Link asChild onClick={(e) => e.stopPropagation()}>
      <IconButton
        aria-label="Open run details"
        size="xs"
        variant="outline"
        title="Open run details"
        onClick={(e) => e.stopPropagation()}
      >
        View
      </IconButton>
    </Link>
  );
}
