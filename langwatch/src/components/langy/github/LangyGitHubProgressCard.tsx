/**
 * Steps card for the PR-opening flow.
 *
 * The card shows checkpoints (cloning → branched → committed → pushed →
 * opened) as Langy's worker runs them. Each event is emitted by the
 * `github.md` skill as a `[langy:progress:...]` sentinel that the manager
 * parses out via {@link parseGithubProgressEvents} — see
 * server/services/langy/githubProgressEvents.ts.
 *
 * Spec: specs/langy/langy-github-prs.feature. Issue: #4747.
 */
import { Box, HStack, Text } from "@chakra-ui/react";
import {
  Check,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Loader,
  Upload,
} from "lucide-react";
import type {
  GithubProgressEvent,
  GithubProgressStage,
} from "~/server/services/langy/githubProgressEvents";

type Step = {
  stage: GithubProgressStage;
  label: string;
  icon: React.ReactNode;
};

// Stages that visibly progress the user-facing card. `cloning` and
// `opening_pr` are transient — the next step's arrival turns them green.
// `edited` is omitted from the visible track because it fires once per file
// and would explode the strip; it still lets us mark "branched" complete.
const TRACK: Step[] = [
  { stage: "cloned", label: "Clone", icon: <Loader size={12} /> },
  { stage: "branched", label: "Branch", icon: <GitBranch size={12} /> },
  { stage: "committed", label: "Commit", icon: <GitCommit size={12} /> },
  { stage: "pushed", label: "Push", icon: <Upload size={12} /> },
  { stage: "opened", label: "PR", icon: <GitPullRequest size={12} /> },
];

export function LangyGitHubProgressCard({
  events,
}: {
  events: GithubProgressEvent[];
}) {
  if (events.length === 0) return null;
  const reached = new Set(events.map((e) => e.stage));
  const latest = events[events.length - 1]?.detail;
  const opened = reached.has("opened");

  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={3}
      background="bg.subtle"
    >
      <HStack gap={2} marginBottom={2}>
        <Text
          textStyle="2xs"
          fontWeight="600"
          letterSpacing="0.08em"
          textTransform="uppercase"
          color="fg.muted"
        >
          {opened ? "Opened" : "Working on it"}
        </Text>
        {latest && (
          <Text textStyle="xs" color="fg.muted" lineHeight={1}>
            {latest}
          </Text>
        )}
      </HStack>
      <HStack gap={2} flexWrap="wrap">
        {TRACK.map((step) => {
          const done = isDoneFor(step.stage, reached);
          return (
            <HStack
              key={step.stage}
              gap={1}
              paddingX={2}
              paddingY={1}
              borderRadius="full"
              borderWidth="1px"
              borderColor={done ? "green.fg" : "border.muted"}
              color={done ? "green.fg" : "fg.muted"}
              fontSize="xs"
            >
              {done ? <Check size={12} /> : step.icon}
              <Text>{step.label}</Text>
            </HStack>
          );
        })}
      </HStack>
    </Box>
  );
}

function isDoneFor(
  stage: GithubProgressStage,
  reached: Set<GithubProgressStage>,
): boolean {
  if (reached.has(stage)) return true;
  // 'cloning' arrives before 'cloned'; cap intermediate states so the cloned
  // pill lights up the moment a clone is in progress.
  if (stage === "cloned" && reached.has("cloning")) return true;
  // Note: 'opening_pr' is the in-flight precursor to 'opened' — we
  // intentionally do NOT light 'opened' until the real 'opened' event
  // arrives, so the final pill flips on PR creation, not on the attempt.
  return false;
}
