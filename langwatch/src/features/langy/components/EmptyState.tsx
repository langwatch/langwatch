import { Box, chakra, Text, VStack } from "@chakra-ui/react";
import {
  ChevronRight,
  GitCompare,
  ScanSearch,
  ShieldCheck,
} from "lucide-react";
import { type ComponentType, useMemo } from "react";
// Lucide dropped its brand glyphs, so the octocat comes from react-feather —
// the same mark LangyGitHubConnectCard uses, so the suggestion and the card you
// land on speak with one icon.
import { GitHub } from "react-feather";
import { emptyStateMetrics } from "./emptyStateMetrics";
import { LangyMark } from "./LangyMark";

/** Structural, so a lucide icon and a react-feather one can sit in one list. */
export type SuggestionIcon = ComponentType<{ size?: string | number }>;

/**
 * What a project must already have for an ask to be able to succeed.
 *
 * Ordered by how much of the product the reader has reached, because that is
 * exactly what governs which asks are honest to offer them: "compare my last
 * two runs" is a dead end until there are two runs.
 */
export type SuggestionRequirement =
  | "nothing"
  | "traces"
  | "evaluations"
  | "experiments";

export interface LangySuggestion {
  icon: SuggestionIcon;
  label: string;
  prompt: string;
  /** Absent means it works from a standing start. */
  requires?: SuggestionRequirement;
}

/**
 * The suggested actions double as onboarding: each one names a different thing
 * Langy can do — read traces, build evals, compare experiments, ship a fix as a
 * PR — so a first-time user learns the range by scanning the list. Simple
 * icon + label rows (Notion-style), not pills; clicking sends the prompt.
 *
 * EVERY ROW MUST BE A THING LANGY CAN ACTUALLY DO. A suggestion that reliably
 * fails is worse than no suggestion — it is the product lying on its own home
 * screen. See the GitHub row for what that constraint cost.
 *
 * Exported because the home page's lit block offers a few of these as its
 * capability row. It reads THIS array rather than keeping a parallel copy, so
 * home can never promise an ask the panel does not offer.
 *
 * The `requires` field is what lets the home page offer a DIFFERENT few to a
 * project that has nothing than to one that has months of runs. The panel's own
 * list below is not filtered by it: by the time someone has opened the panel
 * they have chosen to be here, and the four rows together are how they learn
 * the range. The home page is the surface that meets people who did not choose
 * it, so that is the one that has to earn every row.
 */
export const SUGGESTIONS: LangySuggestion[] = [
  {
    icon: ScanSearch,
    label: "Find failing traces",
    prompt:
      "Find recent traces that are failing their evaluations and tell me why.",
    requires: "evaluations",
  },
  {
    icon: ShieldCheck,
    label: "Set up an evaluator",
    prompt: "Suggest an evaluator for my agent and set it up.",
    requires: "traces",
  },
  {
    icon: GitCompare,
    label: "Compare two runs",
    prompt: "Compare my last two experiment runs and summarise what changed.",
    requires: "experiments",
  },
  {
    // The GitHub glyph, not a generic pull-request icon — this row is the only
    // place a first-time user learns Langy can reach their repo at all. If they
    // haven't connected it, asking is still the right move: the answer is a
    // connect card in the conversation, not a dead end.
    //
    // The wording carries the whole loop — investigate, then ship the fix as a
    // PR — because that IS the loop the agent runs (see
    // app-layer/langyagent/skills/github/SKILL.md: clone → branch → edit →
    // commit → push → `gh pr create`). It stops there, and so does this copy.
    // Opening an ISSUE and VALIDATING a fix are NOT capabilities today — there
    // is no `gh issue create` anywhere in the skill, `githubPrLinks` extracts
    // pull-request URLs only (and has a test asserting it ignores issue URLs),
    // the progress vocabulary ends at `opened`, and the rate limiter is scoped
    // to PR permits. Offering either would be a suggestion that reliably fails.
    icon: GitHub,
    label: "Investigate an issue and open a PR",
    prompt:
      "Investigate a problem in my agent using my traces, then open a GitHub PR that fixes it.",
    requires: "traces",
  },
];

/**
 * What to offer a project that has no data yet.
 *
 * The four above all start from traces, evaluations or experiment runs, so on
 * an empty project every one of them is a dead end — exactly the "suggestion
 * that reliably fails" the note above rules out. These ask Langy to help set
 * the project up instead, which it can do from a standing start, and they live
 * beside their siblings so the same constraint governs both lists.
 */
export const SETUP_SUGGESTIONS: LangySuggestion[] = [
  {
    icon: ScanSearch,
    label: "Send my first trace",
    prompt: "How do I send my first trace to this project?",
  },
  {
    icon: ShieldCheck,
    label: "Choose what to measure",
    prompt:
      "What should I measure about my agent, and which evaluators would you start with?",
  },
  {
    icon: GitCompare,
    label: "Show me around",
    prompt: "What can you do for me on this project, and where should I start?",
  },
];

/**
 * The opening line, of which there are three.
 *
 * There were twenty-three. A rotation that wide stops reading as personality
 * and starts reading as a slot machine: nobody sees the same panel twice, so no
 * line ever becomes Langy's, and the weakest of them set the tone as often as
 * the best. Three lines get remembered.
 *
 * They deliberately do three different jobs, and the split is the point: the
 * first INTRODUCES him and is the joke, the second says what he is actually
 * FOR and is not, the third ASKS for something. Rotating registers rather than
 * lines is what stops a second reading landing as the same gag twice.
 *
 * Kept dry, never cutesy: Langy is a competent teammate having a good day, not
 * a mascot. A fresh one is picked each time the empty state mounts.
 */
const GREETINGS = [
  "Hey, I'm Langy. Haven't hallucinated since 1969.",
  "I read the logs so you don't have to.",
  "Show me where it hurts.",
];

export function EmptyState({
  onPick,
  variant = "floating",
  panelWidth = 432,
}: {
  onPick: (prompt: string) => void;
  variant?: "floating" | "sidebar";
  /**
   * The panel's real rendered width. The floating card ranges ~340–432px with
   * the viewport and the dock is fixed at 392px, so the hero + rows size off THIS
   * rather than the mode — a narrow card no longer gets the same big hero as a
   * roomy one. See `emptyStateMetrics`.
   */
  panelWidth?: number;
}) {
  const sidebar = variant === "sidebar";
  const metrics = emptyStateMetrics({ variant, width: panelWidth });
  const greeting = useMemo(
    () => GREETINGS[Math.floor(Math.random() * GREETINGS.length)],
    [],
  );
  return (
    <VStack
      align="stretch"
      gap={0}
      // `flex="1"` fills the docked sidebar's flex column so `justify="center"`
      // actually centres the hero in the tall dock (ignored in the floating
      // card, whose flow-root parent leaves the state top-aligned as before).
      // `height="full"` keeps the centring working in the floating card's fixed
      // min-height too.
      flex="1"
      height="full"
      justify={sidebar ? "flex-start" : "center"}
      // One centred measure for the whole empty state — the hero and the
      // suggestion list share these bounds, so nothing sits in its own width
      // (the subtitle used to be capped at 260px while the list ran the full
      // ~428px). 360px is ~0.77 of the 468px panel: tight enough that the
      // centred text isn't marooned in air, wide enough that the long GitHub
      // row never wraps — true-golden 0.618 (≈289px) would clip it.
      maxWidth="360px"
      marginX="auto"
      width="full"
      paddingX={3}
      paddingY={sidebar ? 6 : 8}
    >
      <VStack
        gap={0}
        align="center"
        marginBottom={`${metrics.heroMarginBottom}px`}
      >
        {/* The LangWatch mark, in the brand gradient — and the ONLY place it
            appears inside the panel (the launcher is the other). Bare, no tile:
            the orange chip that used to box it in was old-brand chrome, a
            saturated block competing with the display line right under it. It
            shrinks with the card but never below 34px, the smallest size at
            which the box's wireframe still reads as a box rather than a smudge. */}
        <LangyMark size={metrics.markSize} />
        <Text
          fontFamily="var(--langy-font-serif)"
          // At full width the 27px heading is the 44px mark ÷ φ (mark and heading
          // in the golden ratio); both ease down together as the card narrows so
          // the ratio holds across sizes. See `emptyStateMetrics`.
          fontSize={`${metrics.greetingSize}px`}
          fontWeight="500"
          letterSpacing="-0.02em"
          color="fg"
          textAlign="center"
          marginTop={`${metrics.heroGapTop}px`}
        >
          {greeting}
        </Text>
        <Text
          textStyle="sm"
          color="fg.muted"
          lineHeight="1.5"
          textAlign="center"
          // `balance` evens the two lines instead of orphaning "of these." on a
          // row of its own; the cap keeps the measure from running the full
          // column so it stays a tight caption under the hero.
          textWrap="balance"
          maxWidth={`${metrics.subtitleMaxWidth}px`}
          marginTop={2}
        >
          Ask in plain language, or start with one of these.
        </Text>
      </VStack>

      <VStack align="stretch" gap={0.5}>
        {sidebar ? (
          <Text
            textStyle="2xs"
            fontWeight="600"
            letterSpacing="0.08em"
            textTransform="uppercase"
            color="fg.subtle"
            paddingX="10px"
            paddingBottom={1.5}
          >
            Suggested
          </Text>
        ) : null}
        {SUGGESTIONS.map(({ icon, label, prompt }) => (
          <SuggestionRow
            key={label}
            icon={icon}
            label={label}
            paddingX={metrics.rowPaddingX}
            paddingY={metrics.rowPaddingY}
            gap={metrics.rowGap}
            onClick={() => onPick(prompt)}
          />
        ))}
      </VStack>
    </VStack>
  );
}

function SuggestionRow({
  icon: Icon,
  label,
  onClick,
  paddingX,
  paddingY,
  gap,
}: {
  icon: SuggestionIcon;
  label: string;
  onClick: () => void;
  /** Row sizing eases with the panel width — see `emptyStateMetrics`. */
  paddingX: number;
  paddingY: number;
  gap: number;
}) {
  return (
    <chakra.button
      type="button"
      onClick={onClick}
      display="flex"
      alignItems="center"
      gap={`${gap}px`}
      width="full"
      textAlign="left"
      paddingX={`${paddingX}px`}
      paddingY={`${paddingY}px`}
      borderRadius="10px"
      background="transparent"
      color="fg"
      cursor="pointer"
      transition="background 130ms ease"
      _hover={{ background: "bg.subtle" }}
      css={{
        "&:hover .chev": { opacity: 1, transform: "translateX(0)" },
        "&:hover .row-icon": { color: "var(--chakra-colors-fg)" },
      }}
    >
      {/* Neutral, not orange. Four saturated icons stacked down the empty state
          read as a toolbar; the panel's only colour should be the mark. */}
      <Box
        className="row-icon"
        color="fg.subtle"
        flexShrink={0}
        display="grid"
        placeItems="center"
        transition="color 130ms ease"
      >
        <Icon size={16} />
      </Box>
      <Text textStyle="sm" fontWeight="500" flex={1}>
        {label}
      </Text>
      <Box
        className="chev"
        color="fg.subtle"
        opacity={0}
        transform="translateX(-3px)"
        transition="opacity 130ms ease, transform 130ms ease"
      >
        <ChevronRight size={15} />
      </Box>
    </chakra.button>
  );
}
