/**
 * In-chat pull-request card. Rendered when the assistant's reply contains a
 * github.com/owner/repo/pull/N URL — typically the PR the github.md skill
 * just opened.
 *
 * v0 derives owner/repo/number from the URL itself; a follow-up will add live
 * +/- stats and author lookup against the GitHub API using the user's token.
 *
 * Spec: specs/assistant/langy-github-prs.feature. Issue: #4747.
 */
import { Box, HStack, Link, Text, VStack } from "@chakra-ui/react";
import { GitPullRequest } from "react-feather";
import type { GithubPrLink } from "~/server/services/langy/githubPrLinks";

export type LangyGitHubPrCardProps = GithubPrLink;

export function LangyGitHubPrCard({
  owner,
  repo,
  number,
  url,
}: LangyGitHubPrCardProps) {
  return (
    <Link
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      _hover={{ textDecoration: "none" }}
    >
      <Box
        borderWidth="1px"
        borderColor="gray.200"
        borderRadius="md"
        p={3}
        maxWidth="420px"
        bg="white"
        _hover={{ borderColor: "gray.400", bg: "gray.50" }}
        transition="all 120ms"
      >
        <HStack gap={3} align="flex-start">
          <Box pt="2px" color="green.600">
            <GitPullRequest size={18} />
          </Box>
          <VStack align="stretch" gap={0} flex={1}>
            <HStack gap={2} fontSize="sm">
              <Text fontWeight="600">
                {owner}/{repo}
              </Text>
              <Text color="gray.500">#{number}</Text>
            </HStack>
            <Text fontSize="xs" color="gray.500">
              Pull request — open on GitHub
            </Text>
          </VStack>
        </HStack>
      </Box>
    </Link>
  );
}
