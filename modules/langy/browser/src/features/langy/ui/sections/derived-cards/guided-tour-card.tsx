/**
 * The guided tour as the conversation's first entry: a quiet `activity` row that spins while the
 * tour runs, then expands to what the welcome flow collected. Only the button replays the tour.
 * @see specs/langy/langy-guided-onboarding.feature
 */
import { Box, Button, chakra, Spinner, Text } from "@langwatch/design-system/primitives";
import { type GuidedKickoffInput, guidedTourCardRows } from "@langwatch/onboarding-contract";
import { ChevronDown, RotateCw, Route } from "lucide-react";
import { useState } from "react";

import { CARD_TAXONOMY } from "../../../../../model/asaplangy-tokens.ts";
import { useGuidedTour } from "../../../behavior/use-guided-tour.ts";

const TOUR_RUNNING_LABEL = "Doing guided tour";
const TOUR_SETTLED_LABEL = "Guided tour";
const REPLAY_LABEL = "Show me around again";

export function GuidedTourCard({
  kickoff,
  organizationId,
}: {
  /** What the takeover collected; null while the tour runs and no kickoff message exists yet. */
  kickoff: GuidedKickoffInput | null;
  /** The organization the replay is recorded on. Absent = replay only. */
  organizationId?: string | null;
}) {
  const tour = useGuidedTour();
  const running = tour.useRunning();
  const replayTour = tour.useReplay();
  const [open, setOpen] = useState(false);
  const tone = CARD_TAXONOMY.activity;
  const expanded = open && !running && kickoff !== null;

  return (
    <Box
      data-testid="guided-tour-card"
      data-tour-running={running ? "true" : undefined}
      alignSelf="stretch"
      borderRadius="langyCard"
      background="bg.subtle"
      overflow="hidden"
    >
      <chakra.button
        type="button"
        onClick={() => {
          if (!running) setOpen((previous) => !previous);
        }}
        disabled={running}
        aria-expanded={expanded}
        display="flex"
        alignItems="center"
        gap={2}
        width="full"
        paddingX={3.5}
        paddingY={2.5}
        textAlign="left"
        background="transparent"
        cursor={running ? "default" : "pointer"}
        _hover={running ? undefined : { background: "bg.muted" }}
        transition="background 120ms ease"
      >
        {running ? (
          <Spinner size="xs" color={tone.dot} flexShrink={0} />
        ) : (
          <Box color={tone.dot} display="flex" flexShrink={0}>
            <Route size={13} />
          </Box>
        )}
        <Text textStyle="xs" fontWeight={tone.titleWeight} color="fg">
          {running ? TOUR_RUNNING_LABEL : TOUR_SETTLED_LABEL}
        </Text>
        {running ? null : (
          <Box
            marginLeft="auto"
            color="fg.subtle"
            display="flex"
            transition="transform 150ms ease"
            transform={expanded ? "rotate(180deg)" : undefined}
          >
            <ChevronDown size={13} />
          </Box>
        )}
      </chakra.button>
      {expanded && kickoff ? (
        <Box borderTopWidth="1px" borderColor="border.muted" paddingX={3.5} paddingY={3}>
          <chakra.dl display="flex" flexDirection="column" gap={1.5}>
            {guidedTourCardRows(kickoff).map(([label, value]) => (
              <Box key={label} display="flex" gap={3} textStyle="2xs">
                <chakra.dt width="86px" flexShrink={0} color="fg.subtle">
                  {label}
                </chakra.dt>
                <chakra.dd fontWeight="500" color="fg">
                  {value}
                </chakra.dd>
              </Box>
            ))}
          </chakra.dl>
          <Button
            size="xs"
            variant="outline"
            marginTop={3}
            onClick={() => replayTour({ path: kickoff.path, organizationId })}
          >
            <RotateCw size={12} />
            {REPLAY_LABEL}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}
