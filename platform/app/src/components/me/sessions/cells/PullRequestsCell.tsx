import { HStack, Text, VStack } from "@chakra-ui/react";
import type React from "react";

import { Link } from "~/components/ui/link";
import { Tooltip } from "~/components/ui/tooltip";

import type { SessionPullRequest } from "../sessionListRow";
import { MissingValue } from "./MissingValue";

/** How many pull requests a row names before the rest go behind a hover. */
const MAX_LISTED_PULL_REQUESTS = 3;

/**
 * What the session shipped. A session that lands a change, moves to the next
 * branch and opens a second pull request is one session with two, so the row
 * names each of them and links out; past a handful the rest go behind a hover
 * rather than pushing every other column off the page.
 */
export const PullRequestsCell: React.FC<{
  pullRequests: readonly SessionPullRequest[];
}> = ({ pullRequests }) => {
  if (pullRequests.length === 0) {
    return <MissingValue />;
  }

  const listed = pullRequests.slice(0, MAX_LISTED_PULL_REQUESTS);
  const rest = pullRequests.slice(MAX_LISTED_PULL_REQUESTS);

  return (
    <HStack gap={2} whiteSpace="nowrap">
      {listed.map((pullRequest) => (
        // The row opens the replay; this link leaves for GitHub, so it stops
        // the click from reaching the row underneath it.
        <Link
          key={pullRequest.number}
          href={pullRequest.url}
          isExternal
          color="fg.muted"
          fontFamily="mono"
          fontSize="sm"
          onClick={(event) => event.stopPropagation()}
        >
          #{pullRequest.number}
        </Link>
      ))}
      {rest.length > 0 ? (
        <Tooltip
          content={
            <VStack align="start" gap={0.5}>
              {rest.map((pullRequest) => (
                <Text key={pullRequest.number}>
                  #{pullRequest.number} {pullRequest.title}
                </Text>
              ))}
            </VStack>
          }
          positioning={{ placement: "left" }}
        >
          {/* The remaining numbers are written down nowhere else on this row,
              so the hover has a tab stop behind it. */}
          <Text
            as="span"
            fontSize="sm"
            color="fg.muted"
            cursor="help"
            tabIndex={0}
          >
            +{rest.length}
          </Text>
        </Tooltip>
      ) : null}
    </HStack>
  );
};
