import { chakra, HStack, Text, VStack } from "@chakra-ui/react";
import {
  MissingValue,
  type SessionPullRequest,
} from "@langwatch/coding-agent-web";
import type React from "react";

import { Tooltip } from "~/components/ui/tooltip";

/** How many pull requests a row names before the rest go behind a hover. */
const MAX_LISTED_PULL_REQUESTS = 3;

/**
 * What the session shipped. A session that lands a change, moves to the next
 * branch and opens a second pull request is one session with two, so the row
 * names each of them; past a handful the rest go behind a hover rather than
 * pushing every other column off the page.
 *
 * A number opens the pull request's own detail, the same drawer the pull
 * requests screen opens, because what a reader wants from this column is what
 * the change cost across every session that worked on it. GitHub is one more
 * click from there, in the drawer's own header.
 */
export const PullRequestsCell: React.FC<{
  pullRequests: readonly SessionPullRequest[];
  onOpenDetail: (pullRequest: SessionPullRequest) => void;
}> = ({ pullRequests, onOpenDetail }) => {
  if (pullRequests.length === 0) {
    return <MissingValue />;
  }

  const listed = pullRequests.slice(0, MAX_LISTED_PULL_REQUESTS);
  const rest = pullRequests.slice(MAX_LISTED_PULL_REQUESTS);

  return (
    <HStack gap={2} whiteSpace="nowrap">
      {listed.map((pullRequest) => (
        // The row opens the replay; this opens the pull request instead, so
        // it stops the click from reaching the row underneath it.
        <chakra.button
          key={pullRequest.number}
          type="button"
          aria-label={`Open pull request #${pullRequest.number}`}
          onClick={(event) => {
            event.stopPropagation();
            onOpenDetail(pullRequest);
          }}
          bg="transparent"
          border="none"
          padding={0}
          cursor="pointer"
          color="fg.muted"
          fontFamily="mono"
          fontSize="sm"
          // Underlined because it is the one part of the row that goes
          // somewhere other than where the row goes.
          textDecoration="underline"
          textUnderlineOffset="3px"
          _hover={{ color: "fg" }}
        >
          #{pullRequest.number}
        </chakra.button>
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
