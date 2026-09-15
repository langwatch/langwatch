/**
 * The hero's opening line: a time-of-day greeting, same serif voice as the
 * project home's. Ported from `.../components/home/WelcomeHeader.tsx`
 * (main), which greets by first name. The reader comes from
 * `GovernanceHostPort.currentUser()`; an absent one — not signed in, or not
 * answered yet — falls back to the anonymous greeting rather than a blank.
 */
import { Heading } from "@chakra-ui/react";
import { useGovernanceHost } from "../../../../model/governance-host.ts";
import { useEffect, useState } from "react";
import { SERIF } from "@langwatch/langy-web/surfaces/asaplangy";
import { nowInstant, toZonedDateTime } from "@langwatch/time";

export type TimeOfDay = "morning" | "afternoon" | "evening";

export const getTimeOfDay = (hour: number): TimeOfDay => {
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
};

const GREETINGS: Record<TimeOfDay, string> = {
  morning: "Good morning",
  afternoon: "Good afternoon",
  evening: "Good evening",
};

/**
 * The clock's read of the day, resolved client-side after mount (so SSR and
 * first paint agree on "morning" and never mismatch hydration).
 */
export function useTimeOfDay(): TimeOfDay {
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>("morning");
  useEffect(() => {
    setTimeOfDay(getTimeOfDay(toZonedDateTime(nowInstant()).hour));
  }, []);
  return timeOfDay;
}

/** The name a greeting uses: the first word of it, or nothing. */
function firstName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

export function GovernanceWelcomeHeader() {
  const timeOfDay = useTimeOfDay();
  const reader = firstName(useGovernanceHost().currentUser()?.name);

  return (
    // The page's serif display voice: the greeting is the hero's one big
    // line, so it speaks in the same face as the project home's own greeting.
    <Heading
      as="h1"
      fontFamily={SERIF}
      fontWeight="500"
      fontSize="26px"
      letterSpacing="-0.01em"
      lineHeight="1.2"
    >
      {reader ? `${GREETINGS[timeOfDay]}, ${reader}` : GREETINGS[timeOfDay]}
    </Heading>
  );
}
