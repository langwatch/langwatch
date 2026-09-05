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
 * The last step carries the pull request's own URL when `gh pr create` printed
 * one, so the PR pill is a link straight to it.
 *
 * Spec: specs/langy/langy-github-prs.feature. Issue: #4747.
 */
import { Box, HStack, Link, Text } from "@chakra-ui/react";
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

/**
 * What a settled turn reached, furthest step first. A finished turn is never
 * "working on it" — it either opened the pull request or it stopped somewhere,
 * and the card says which.
 */
const SETTLED_LABELS: { stage: GithubProgressStage; label: string }[] = [
  { stage: "opened", label: "Opened" },
  { stage: "pushed", label: "Pushed" },
  { stage: "committed", label: "Committed" },
  { stage: "branched", label: "Branched" },
  { stage: "cloned", label: "Cloned" },
  { stage: "cloning", label: "Cloned" },
];

export function LangyGitHubProgressCard({
  events,
  live = false,
}: {
  events: GithubProgressEvent[];
  /** The turn is still running. A settled turn stops saying "working on it". */
  live?: boolean;
}) {
  if (events.length === 0) return null;
  const reached = new Set(events.map((e) => e.stage));
  const latest = events[events.length - 1]?.detail;
  const opened = reached.has("opened");
  // `gh pr create` printed it, so the last pill can lead to the pull request.
  const prUrl = events.find((event) => event.stage === "opened")?.url;
  // Single mono label line, e.g. "WORKING ON IT · PUSHING BRANCH…" while the
  // turn runs, and the furthest step reached once it has ended.
  const label = opened
    ? "Opened"
    : !live
      ? (SETTLED_LABELS.find((entry) => reached.has(entry.stage))?.label ??
        "Finished")
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
          const href = step.stage === "opened" ? prUrl : undefined;
          const pill = {
            gap: 1,
            paddingX: 2.5,
            paddingY: 1,
            borderRadius: "full",
            borderWidth: "1px",
            borderColor: done ? "green.fg" : "border.muted",
            color: done ? "green.fg" : "fg.muted",
            textStyle: "xs",
          } as const;
          const content = (
            <>
              {done ? <Check size={12} /> : null}
              <Text>{step.label}</Text>
            </>
          );

          return href ? (
            <Link
              key={step.stage}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              display="inline-flex"
              alignItems="center"
              {...pill}
              _hover={{ borderColor: "green.fg", textDecoration: "none" }}
            >
              {content}
            </Link>
          ) : (
            <HStack key={step.stage} {...pill}>
              {content}
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
