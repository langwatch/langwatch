import { Button } from "@chakra-ui/react";
import { ExternalLink } from "react-feather";
import { Link } from "~/components/ui/link";
import { Tooltip } from "~/components/ui/tooltip";

/**
 * Links the studio evaluations panel across to the full experiment
 * results page, scoped to the selected run (the results page reads
 * `runId` from the query string).
 */
export function OpenFullResultsButton({
  projectSlug,
  experimentSlug,
  runId,
}: {
  projectSlug: string;
  experimentSlug: string;
  runId: string;
}) {
  return (
    <Tooltip
      content="Open the full results page for this run"
      positioning={{ placement: "top" }}
      openDelay={100}
    >
      <Button size="sm" variant="outline" asChild>
        <Link
          href={`/${projectSlug}/experiments/${experimentSlug}?runId=${runId}`}
          target="_blank"
          rel="noreferrer"
          data-testid="open-full-results"
        >
          <ExternalLink size={14} />
          Open full results
        </Link>
      </Button>
    </Tooltip>
  );
}
