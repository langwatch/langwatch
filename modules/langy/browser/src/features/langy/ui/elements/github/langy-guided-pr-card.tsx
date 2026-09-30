/**
 * The card that closes a guided path: the pull request with the tracing change, or the branch
 * that holds it when no pull request could be opened. The one place at the very end that the
 * reader can act on (card taxonomy: spotlight).
 * @see specs/langy/langy-guided-onboarding.feature
 */
import { Button, Text, VStack } from "@chakra-ui/react";
import { LangyCard } from "@langwatch/langy-browser-kit";
import type { GuidedPullRequest } from "@langwatch/onboarding-browser-kit";
import { ArrowUpRight, GitBranch, GitPullRequest } from "lucide-react";

function BranchLine({ branch }: { branch: string }) {
  return (
    <Text textStyle="xs" color="fg.muted">
      <GitBranch size={12} style={{ display: "inline", verticalAlign: "-2px" }} /> {branch}
    </Text>
  );
}

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
            <GitBranch size={12} style={{ display: "inline", verticalAlign: "-2px" }} /> This branch
            holds the tracing commit. No pull request was opened, because the folder has no remote
            or GitHub is not signed in.
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
        {branch ? <BranchLine branch={branch} /> : null}
        <Text textStyle="xs" color="fg.muted" wordBreak="break-all">
          {url}
        </Text>
      </VStack>
    </LangyCard>
  );
}
