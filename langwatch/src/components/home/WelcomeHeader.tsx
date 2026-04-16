import { Heading } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { useSession } from "~/utils/auth-client";

/**
 * Extract greeting name from user's name.
 * Returns the first name if available, null if unavailable or looks like an email.
 */
export const getGreetingName = (
  name: string | null | undefined,
): string | null => {
  if (!name || !name.trim()) {
    return null;
  }

  const trimmedName = name.trim();

  // If it looks like an email, don't use it
  if (trimmedName.includes("@")) {
    return null;
  }

  // Extract first name (before first space)
  const firstName = trimmedName.split(" ")[0];
  return firstName ?? null;
};

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

export function WelcomeHeader() {
  const { data: session } = useSession();
  const greetingName = getGreetingName(session?.user?.name);
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>("morning");

  useEffect(() => {
    setTimeOfDay(getTimeOfDay(new Date().getHours()));
  }, []);

  return (
    <Heading as="h1" size="lg">
      {getGreeting({ timeOfDay, name: greetingName })}
    </Heading>
  );
}
