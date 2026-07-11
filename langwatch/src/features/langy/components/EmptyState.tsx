import { Box, chakra, Text, VStack } from "@chakra-ui/react";
import {
  ChevronRight,
  GitCompare,
  ScanSearch,
  ShieldCheck,
} from "lucide-react";
import type { ComponentType } from "react";
// Lucide dropped its brand glyphs, so the octocat comes from react-feather —
// the same mark LangyGitHubConnectCard uses, so the suggestion and the card you
// land on speak with one icon.
import { GitHub } from "react-feather";
import { LangyMark } from "./LangyMark";

/** Structural, so a lucide icon and a react-feather one can sit in one list. */
type SuggestionIcon = ComponentType<{ size?: string | number }>;

/**
 * The suggested actions double as onboarding: each one names a different thing
 * Langy can do — read traces, build evals, compare experiments, ship a fix as a
 * PR — so a first-time user learns the range by scanning the list. Simple
 * icon + label rows (Notion-style), not pills; clicking sends the prompt.
 *
 * EVERY ROW MUST BE A THING LANGY CAN ACTUALLY DO. A suggestion that reliably
 * fails is worse than no suggestion — it is the product lying on its own home
 * screen. See the GitHub row for what that constraint cost.
 */
const SUGGESTIONS: { icon: SuggestionIcon; label: string; prompt: string }[] = [
  {
    icon: ScanSearch,
    label: "Find failing traces",
    prompt:
      "Find recent traces that are failing their evaluations and tell me why.",
  },
  {
    icon: ShieldCheck,
    label: "Set up an evaluator",
    prompt: "Suggest an evaluator for my agent and set it up.",
  },
  {
    icon: GitCompare,
    label: "Compare two runs",
    prompt: "Compare my last two experiment runs and summarise what changed.",
  },
  {
    // The GitHub glyph, not a generic pull-request icon — this row is the only
    // place a first-time user learns Langy can reach their repo at all. If they
    // haven't connected it, asking is still the right move: the answer is a
    // connect card in the conversation, not a dead end.
    //
    // The wording carries the whole loop — investigate, then ship the fix as a
    // PR — because that IS the loop the agent runs (see
    // services/langyagent/skills/github/SKILL.md: clone → branch → edit →
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
  },
];

export function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <VStack
      align="stretch"
      gap={0}
      height="full"
      justify="center"
      paddingX={5}
      paddingY={8}
    >
      <VStack gap={0} align="center" marginBottom={7}>
        {/* The LangWatch mark, in the brand gradient — and the ONLY place it
            appears inside the panel (the launcher is the other). Bare, no tile:
            the orange chip that used to box it in was old-brand chrome, a
            saturated block competing with the display line right under it. 44px
            is also the smallest size at which the box's wireframe still reads
            as a box rather than a smudge. */}
        <LangyMark size={44} />
        <Text
          fontFamily="var(--langy-font-serif)"
          fontSize="24px"
          fontWeight="500"
          letterSpacing="-0.02em"
          color="fg"
          textAlign="center"
          marginTop={4}
        >
          How can I help?
        </Text>
        <Text
          textStyle="sm"
          color="fg.muted"
          lineHeight="1.5"
          textAlign="center"
          maxWidth="260px"
          marginTop={2}
        >
          Ask in plain language — or start with one of these.
        </Text>
      </VStack>

      <VStack align="stretch" gap={0.5}>
        {SUGGESTIONS.map(({ icon, label, prompt }) => (
          <SuggestionRow
            key={label}
            icon={icon}
            label={label}
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
}: {
  icon: SuggestionIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <chakra.button
      type="button"
      onClick={onClick}
      display="flex"
      alignItems="center"
      gap={3}
      width="full"
      textAlign="left"
      paddingX={2.5}
      paddingY={2.5}
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
