/**
 * Steps card for the PR-opening flow.
 *
 * The card shows checkpoints (cloning → branched → committed → pushed → opened)
 * as Langy's worker runs them. Each event is derived from the turn's TOOL PARTS
 * via {@link githubProgressFromToolParts} — `git push` IS the push, so the card
 * reads what the agent actually ran rather than a `[langy:progress:...]` marker
 * the model was asked to print into its reply. See
 * server/app-layer/langy/execution/githubCommand.ts.
 *
 * Because tool parts are persisted with the message (the sentinels were stripped
 * before persistence), the card now survives a refresh. It did not used to.
 *
 * Spec: specs/langy/langy-github-prs.feature. Issue: #4747.
 */
import { Box, HStack, Text } from "@chakra-ui/react";
import { Check } from "lucide-react";
import type {
  GithubProgressEvent,
  GithubProgressStage,
} from "~/server/app-layer/langy/execution/githubCommand";

type Step = {
  stage: GithubProgressStage;
  label: string;
};

// Stages that visibly progress the user-facing card. `cloning` and
// `opening_pr` are transient — the next step's arrival turns them green.
// (There is no `edited` stage any more: the tool stream has no single moment
// that is "the edit", and this track never rendered one. The tool cards already
// show which files were written.)
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
