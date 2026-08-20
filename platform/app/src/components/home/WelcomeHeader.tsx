import { Heading } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { SERIF } from "~/features/asaplangy";
import { useSession } from "~/utils/auth-client";
import { displayFirstName } from "~/utils/displayName";

export type TimeOfDay = "morning" | "afternoon" | "evening";

export const getTimeOfDay = (hour: number): TimeOfDay => {
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
};

const GREETINGS: Record<TimeOfDay, { named: string; anonymous: string }> = {
  morning: { named: "Good morning, ", anonymous: "Good morning" },
  afternoon: { named: "Good afternoon, ", anonymous: "Good afternoon" },
  evening: { named: "Good evening, ", anonymous: "Good evening" },
};

export const getGreeting = ({
  timeOfDay,
  name,
}: {
  timeOfDay: TimeOfDay;
  name: string | null;
}): string => {
  const { named, anonymous } = GREETINGS[timeOfDay];
  return name ? `${named}${name}` : anonymous;
};

/**
 * The clock's read of the day, resolved client-side after mount (so SSR and
 * first paint agree on "morning" and never mismatch hydration). Feeds the
 * greeting.
 */
export function useTimeOfDay(): TimeOfDay {
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>("morning");
  useEffect(() => {
    setTimeOfDay(getTimeOfDay(new Date().getHours()));
  }, []);
  return timeOfDay;
}

export function WelcomeHeader() {
  const { data: session } = useSession();
  const greetingName = displayFirstName(session?.user?.name);
  const timeOfDay = useTimeOfDay();

  return (
    // The page's serif display voice: the greeting is the home's one big line,
    // so it speaks in the same face as the briefing headline below it.
    <Heading
      as="h1"
      fontFamily={SERIF}
      fontWeight="500"
      fontSize="26px"
      letterSpacing="-0.01em"
      lineHeight="1.2"
    >
      {getGreeting({ timeOfDay, name: greetingName })}
    </Heading>
  );
}
