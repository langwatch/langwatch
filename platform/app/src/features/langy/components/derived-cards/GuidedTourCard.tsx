/**
 * The guided tour, as the conversation's first entry.
 *
 * The kickoff user message carries the takeover's picks as a typed part, and
 * this card is how that message renders: a tool-call style row (taxonomy
 * `activity`, the quietest weight) that spins while the tour runs and settles
 * to an expandable summary of what the welcome flow collected. Clicking the
 * row only expands it; only the button replays the tour, and a replay is
 * recorded on the organization.
 *
 * @see specs/langy/langy-guided-onboarding.feature
 */
import { Box, Button, chakra, Spinner, Text } from "@chakra-ui/react";
import { ChevronDown, RotateCw, Route } from "lucide-react";
import { useState } from "react";

import { CARD_TAXONOMY } from "~/features/asaplangy";
import {
  type GuidedKickoffInput,
  guidedTourCardRows,
} from "~/features/guided-onboarding/kickoff";
import { useGuidedTourStore } from "~/features/guided-onboarding/tour/guidedTourStore";
import { api } from "~/utils/api";

const TOUR_RUNNING_LABEL = "Doing guided tour";
const TOUR_SETTLED_LABEL = "Guided tour";
const REPLAY_LABEL = "Show me around again";

export function GuidedTourCard({
  kickoff,
  organizationId,
}: {
  /**
   * What the takeover collected. Null while the tour is still running and
   * the kickoff message does not exist yet: the panel then shows this card
   * in its in-progress state in place of the empty state, so the row is
   * visible for the whole tour and the real kickoff message takes over
   * without a flash.
   */
  kickoff: GuidedKickoffInput | null;
  /** The organization the replay is recorded on. Absent = replay only. */
  organizationId?: string | null;
}) {
  const running = useGuidedTourStore((s) => s.running);
  const [open, setOpen] = useState(false);
  const recordTour = api.onboarding.recordTour.useMutation();
  const tone = CARD_TAXONOMY.activity;

  const replay = () => {
    if (!kickoff) return;
    useGuidedTourStore.getState().replay(kickoff.path);
    if (organizationId) {
      recordTour.mutate({ organizationId, status: "replayed" });
    }
  };

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
        <Box
          borderTopWidth="1px"
          borderColor="border.muted"
          paddingX={3.5}
          paddingY={3}
        >
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
            onClick={replay}
            loading={recordTour.isPending}
          >
            <RotateCw size={12} />
            {REPLAY_LABEL}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}
