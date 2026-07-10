/**
 * In-chat pull-request card. Rendered when the assistant's reply contains a
 * github.com/owner/repo/pull/N URL — typically the PR the github.md skill
 * just opened.
 *
 * v0 derives owner/repo/number from the URL itself; a follow-up will add live
 * +/- stats and author lookup against the GitHub API using the user's token.
 *
 * Spec: specs/langy/langy-github-prs.feature. Issue: #4747.
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
        borderColor="border"
        borderRadius="md"
        p={3}
        maxWidth="420px"
        bg="bg.panel"
        _hover={{ borderColor: "border.emphasized", bg: "bg.subtle" }}
        transition="all 120ms"
      >
        <HStack gap={3} align="flex-start">
          <Box pt="2px" color="green.fg">
            <GitPullRequest size={18} />
          </Box>
          <VStack align="stretch" gap={0} flex={1}>
            <HStack gap={2} fontSize="sm">
              <Text fontWeight="600" color="fg">
                {owner}/{repo}
              </Text>
              <Text color="fg.muted">#{number}</Text>
            </HStack>
            <Text fontSize="xs" color="fg.muted">
              Pull request — open on GitHub
            </Text>
          </VStack>
        </HStack>
      </Box>
    </Link>
  );
}
