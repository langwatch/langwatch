/**
 * In-chat pull-request card.
 *
 * Driven by the `github.open_pr` TOOL PART the turn processor writes after
 * `gh pr create` settles — enriched from the GitHub API with the user's own
 * token, off the PR identity the command's stdout gave us.
 *
 * It is NOT scraped from the assistant's reply any more. That was the last place
 * in Langy's UI steered by regexing the model's text, and it had the usual three
 * faults: the model could mangle the URL, omit it, or merely MENTION a PR it had
 * never opened and get a card for it. A tool part cannot lie, it carries
 * structure, and it is persisted with the message — so this card survives a
 * refresh, which the prose card never did.
 *
 * DEGRADES HONESTLY. `owner/repo#number` and the URL always exist (stdout). The
 * rich half — title, branches, author, diff stat — is optional, because the
 * GitHub lookup can fail for reasons that say nothing about the PR (an expired
 * token, a repo gone private, a rate limit). When it does, the card shows what we
 * know rather than a half-populated lie, or an error where a PR should be.
 *
 * Visuals live inside the Langy card kit: a hairline border on a subtle ground,
 * no shadow, semantic tokens only.
 *
 * Spec: specs/langy/langy-github-prs.feature. Issue: #4747.
 */
import { Box, HStack, Link, Text, VStack } from "@chakra-ui/react";
import {
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  type LucideIcon,
} from "lucide-react";
import type {
  GithubPrCardData,
  GithubPrState,
} from "~/shared/langy/githubPrCard";

export type LangyGitHubPrCardProps = GithubPrCardData;

/** GitHub's own semantics, in semantic tokens: open is green, merged purple. */
const STATE_STYLE: Record<
  GithubPrState,
  { label: string; color: string; Icon: LucideIcon }
> = {
  draft: { label: "Draft", color: "fg.muted", Icon: GitPullRequest },
  open: { label: "Open", color: "green.fg", Icon: GitPullRequest },
  merged: { label: "Merged", color: "purple.fg", Icon: GitMerge },
  closed: { label: "Closed", color: "red.fg", Icon: GitPullRequestClosed },
};

export function LangyGitHubPrCard({
  owner,
  repo,
  number,
  url,
  state,
  title,
  headRef,
  baseRef,
  author,
  additions,
  deletions,
  changedFiles,
}: LangyGitHubPrCardProps) {
  const { label, color, Icon } = STATE_STYLE[state] ?? STATE_STYLE.open;
  const hasDiff =
    additions !== undefined ||
    deletions !== undefined ||
    changedFiles !== undefined;
  const hasBranches = !!headRef && !!baseRef;

  return (
    <Link
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      _hover={{ textDecoration: "none" }}
    >
      <Box
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="md"
        padding={3}
        maxWidth="420px"
        background="bg.subtle"
        _hover={{ borderColor: "border.emphasized" }}
        transition="border-color 120ms ease"
      >
        <VStack align="stretch" gap={2}>
          <HStack gap={2.5} align="flex-start">
            <Box paddingTop="1px" color={color} flexShrink={0}>
              <Icon size={16} />
            </Box>
            <VStack align="stretch" gap={0.5} flex={1} minWidth={0}>
              {/* The TITLE leads when we have it — it is what the PR IS, and what
                  someone scanning the conversation actually reads; the repo and
                  number drop to a subtitle. With no title (the lookup failed) the
                  identity leads instead and the card simply says less, rather
                  than pretending to know more. */}
              {title ? (
                <Text
                  textStyle="sm"
                  fontWeight="640"
                  color="fg"
                  lineHeight="1.35"
                  lineClamp={2}
                >
                  {title}
                </Text>
              ) : (
                <Text textStyle="sm" fontWeight="640" color="fg">
                  {owner}/{repo}
                  <Text as="span" color="fg.muted" fontWeight="400">
                    {" "}
                    #{number}
                  </Text>
                </Text>
              )}

              <HStack gap={1.5} textStyle="xs" color="fg.muted" flexWrap="wrap">
                {title ? (
                  <Text as="span">
                    {owner}/{repo} #{number}
                  </Text>
                ) : null}
                <Text as="span" color={color} fontWeight="500">
                  {label}
                </Text>
                {author ? <Text as="span">· {author}</Text> : null}
              </HStack>
            </VStack>
          </HStack>

          {hasBranches || hasDiff ? (
            <HStack
              gap={2.5}
              textStyle="2xs"
              color="fg.subtle"
              fontFamily="mono"
              flexWrap="wrap"
            >
              {hasBranches ? (
                <Text as="span" truncate maxWidth="220px">
                  {headRef} → {baseRef}
                </Text>
              ) : null}
              {hasDiff ? (
                <HStack gap={1.5}>
                  {changedFiles !== undefined ? (
                    <Text as="span">
                      {changedFiles} {changedFiles === 1 ? "file" : "files"}
                    </Text>
                  ) : null}
                  {additions !== undefined ? (
                    <Text as="span" color="green.fg">
                      +{additions}
                    </Text>
                  ) : null}
                  {deletions !== undefined ? (
                    <Text as="span" color="red.fg">
                      −{deletions}
                    </Text>
                  ) : null}
                </HStack>
              ) : null}
            </HStack>
          ) : null}
        </VStack>
      </Box>
    </Link>
  );
}
