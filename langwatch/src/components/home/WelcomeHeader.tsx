import { Heading } from "@chakra-ui/react";
import { useSession } from "next-auth/react";

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

/**
 * WelcomeHeader
 * Displays a personalized greeting to the user.
 * Shows "Hello, {firstName}" if available, otherwise "Hello 👋"
 */
export function WelcomeHeader() {
  const { data: session } = useSession();
  const greetingName = getGreetingName(session?.user?.name);

  return (
    <Heading as="h1" size="lg">
      {greetingName ? `Hello, ${greetingName}` : "Hello 👋"}
    </Heading>
  );
}
