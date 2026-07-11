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
import { Check } from "lucide-react";
import type {
  GithubProgressEvent,
  GithubProgressStage,
} from "~/server/services/langy/githubProgressEvents";

type Step = {
  stage: GithubProgressStage;
  label: string;
};

// Stages that visibly progress the user-facing card. `cloning` and
// `opening_pr` are transient — the next step's arrival turns them green.
// `edited` is omitted from the visible track because it fires once per file
// and would explode the strip; it still lets us mark "branched" complete.
const TRACK: Step[] = [
  { stage: "cloned", label: "Clone" },
  { stage: "branched", label: "Branch" },
  { stage: "committed", label: "Commit" },
  { stage: "pushed", label: "Push" },
  { stage: "opened", label: "PR" },
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
  // Single mono label line, e.g. "WORKING ON IT · PUSHING BRANCH…".
  const label = opened
    ? "Opened"
    : latest
      ? `Working on it · ${latest}`
      : "Working on it";

  return (
    <Box
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      padding={3}
      background="bg.subtle"
    >
      <Text
        textStyle="2xs"
        fontFamily="mono"
        fontWeight="600"
        letterSpacing="0.07em"
        textTransform="uppercase"
        color="fg.muted"
        marginBottom={2}
      >
        {label}
      </Text>
      <HStack gap={1.5} flexWrap="wrap">
        {TRACK.map((step) => {
          const done = isDoneFor(step.stage, reached);
          return (
            <HStack
              key={step.stage}
              gap={1}
              paddingX={2.5}
              paddingY={1}
              borderRadius="full"
              borderWidth="1px"
              borderColor={done ? "green.fg" : "border.muted"}
              color={done ? "green.fg" : "fg.muted"}
              textStyle="xs"
            >
              {done ? <Check size={12} /> : null}
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
