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

export type LangyGitHubPrCardProps = {
  owner: string;
  repo: string;
  number: number;
  url: string;
};

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

/**
 * Extract zero-or-more PR references from an assistant text. The reply may
 * contain prose with one or more github.com PR URLs; we render a card per
 * unique URL and keep the surrounding prose in the markdown body.
 */
export function extractPrLinks(text: string): LangyGitHubPrCardProps[] {
  const re =
    /https?:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)\/pull\/(\d+)\b/g;
  const seen = new Set<string>();
  const out: LangyGitHubPrCardProps[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const [url, owner, repo, numberStr] = m;
    const key = `${owner}/${repo}#${numberStr}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ owner, repo, number: Number(numberStr), url });
  }
  return out;
}
