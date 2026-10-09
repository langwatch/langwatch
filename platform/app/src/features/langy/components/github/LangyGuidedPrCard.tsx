/**
 * The card that closes a guided path: the pull request with the tracing
 * change, or the branch that holds it when no pull request could be opened.
 *
 * The skill already said the address in a sentence before the proposal; this
 * card is the one place at the very end, after the closing line, that the
 * reader can act on (card taxonomy: spotlight). It is derived from the
 * conversation's own tool calls (`guidedPullRequestFromMessages`), never
 * from the prose.
 */
import { Button, Text, VStack } from "@chakra-ui/react";
import { ArrowUpRight, GitBranch, GitPullRequest } from "lucide-react";
import { LangyCard } from "~/features/asaplangy";
import type { GuidedPullRequest } from "~/features/guided-onboarding/guidedConversation";

export function LangyGuidedPrCard({ url, title, branch }: GuidedPullRequest) {
  if (!url) {
    return (
      <LangyCard
        intent="spotlight"
        overline="Branch"
        title={branch ?? "Your branch"}
        aria-label="Guided path branch"
      >
        <VStack align="stretch" gap={1}>
          <Text textStyle="xs" color="fg.muted">
            <GitBranch
              size={12}
              style={{ display: "inline", verticalAlign: "-2px" }}
            />{" "}
            This branch holds the tracing commit. No pull request was opened,
            because the folder has no remote or GitHub is not signed in.
          </Text>
        </VStack>
      </LangyCard>
    );
  }
  return (
    <LangyCard
      intent="spotlight"
      overline="Pull request"
      title={title ?? "Add LangWatch tracing and the connect endpoint"}
      aria-label="Guided path pull request"
      actions={
        <Button asChild size="xs" colorPalette="orange">
          <a href={url} target="_blank" rel="noopener noreferrer">
            <GitPullRequest size={12} /> Open pull request
            <ArrowUpRight size={12} />
          </a>
        </Button>
      }
    >
      <VStack align="stretch" gap={1}>
        {branch ? (
          <Text textStyle="xs" color="fg.muted">
            <GitBranch
              size={12}
              style={{ display: "inline", verticalAlign: "-2px" }}
            />{" "}
            {branch}
          </Text>
        ) : null}
        <Text textStyle="xs" color="fg.muted" wordBreak="break-all">
          {url}
        </Text>
      </VStack>
    </LangyCard>
  );
}
