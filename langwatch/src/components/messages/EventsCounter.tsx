import { Box, HStack, Text } from "@chakra-ui/react";
import type { Trace } from "../../server/tracer/types";
import { ThumbsDown, ThumbsUp } from "react-feather";

export function EventsCounter({
  trace,
  addDot = true,
}: {
  trace: Trace;
  addDot?: boolean;
}) {
  if (!trace.events || trace.events.length == 0) {
    return null;
  }

  return (
    <>
      {addDot && <Text>·</Text>}
      <HStack>
        <Box width="6px" height="6px" borderRadius="100%" bg="green.500"></Box>
        <Text>{trace.events.length} events</Text>
      </HStack>
      <ThumbsUpDown trace={trace} />
    </>
  );
}

export function ThumbsUpDown({ trace }: { trace: Trace }) {
  const lastThumbsUpDownEvent = trace.events
    ?.sort(
      (a, b) =>
        (b.timestamps.started_at || b.timestamps.inserted_at) -
        (a.timestamps.started_at || a.timestamps.inserted_at)
    )
    .find((event) => event.event_type === "thumbs_up_down");

  const vote = lastThumbsUpDownEvent?.metrics?.vote;

  if (!vote) {
    return null;
  }

  return (
    <>
      <Text>·</Text>
      <HStack>
        <Box>{vote == 1 ? <ThumbsUp size="12px" /> : <ThumbsDown size="12px" />}</Box>
        <Text>{vote == 1 ? "Thumbs Up" : "Thumbs Down"}</Text>
      </HStack>
    </>
  );
}
