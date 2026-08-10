import { Table } from "@chakra-ui/react";
import type React from "react";

import { Link } from "~/components/ui/link";

/**
 * The width a contributor's name is allowed to take.
 *
 * A shared project can be named at any length, and left alone one long name
 * sizes the whole table past the drawer and pushes the numbers out of sight,
 * so the column is bounded and anything longer is cut with the whole name on
 * hover.
 */
const CONTRIBUTOR_COLUMN_WIDTH = "220px";

/** One contributor's name: a person, or a project that opens its traces. */
export const ContributorName: React.FC<{
  contributor: {
    contributorLabel: string;
    projectSlug: string;
    contributorIsProject: boolean;
  };
}> = ({ contributor }) => (
  <Table.Cell
    fontSize="sm"
    maxWidth={CONTRIBUTOR_COLUMN_WIDTH}
    truncate
    title={contributor.contributorLabel}
  >
    {contributor.contributorIsProject && contributor.projectSlug ? (
      <Link href={`/${contributor.projectSlug}/traces`} color="blue.fg">
        {contributor.contributorLabel}
      </Link>
    ) : (
      contributor.contributorLabel
    )}
  </Table.Cell>
);
