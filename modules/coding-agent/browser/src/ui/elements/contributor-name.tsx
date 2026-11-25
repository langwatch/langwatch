import { ListTable } from "@langwatch/design-system/list-table";
import type React from "react";

import { Link } from "./activity-link.tsx";

/**
 * The width a contributor's name is allowed to take. A shared project can be
 * named at any length, and one long name would size the whole table past the
 * drawer — so the column is bounded and anything longer is cut, full name on hover.
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
  <ListTable.Cell maxWidth={CONTRIBUTOR_COLUMN_WIDTH} truncate title={contributor.contributorLabel}>
    {contributor.contributorIsProject && contributor.projectSlug ? (
      <Link href={`/${contributor.projectSlug}/traces`} color="blue.fg">
        {contributor.contributorLabel}
      </Link>
    ) : (
      contributor.contributorLabel
    )}
  </ListTable.Cell>
);
