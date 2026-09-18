import type { TypeSegment } from "./Typewriter";

/**
 * The lines Langy types on the takeover screens. Framework-free so the
 * screens, their tests and any transcript render the same words.
 */

/** The first name of the signed-in user, or "there" when the account has none. */
export function greetingName(fullName: string | null | undefined): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  return first || "there";
}

/**
 * Who the value question sets things up for: the organization, unless the
 * user is on their own (or never named one), in which case "you".
 */
export function setupTarget({
  organizationName,
  usageStyle,
}: {
  organizationName: string | null | undefined;
  usageStyle: string | null | undefined;
}): string {
  const name = (organizationName ?? "").trim();
  return usageStyle === "For myself" || !name ? "you" : name;
}

export function helloSegments(name: string): TypeSegment[] {
  return [
    { text: `Hello ${name}`, pauseAfter: 650 },
    { text: ", I'm Langy 👋", pauseAfter: 750 },
    // The blank line lands before the second sentence types, so the greeting
    // drifts up as it goes: the block is centred on the screen.
    { text: "\n\n", pauseAfter: 900 },
    { text: "I'll be your guide today." },
  ];
}

export function valueSegments({
  name,
  target,
}: {
  name: string;
  target: string;
}): TypeSegment[] {
  return [
    { text: `So tell me, ${name},`, pauseAfter: 700 },
    {
      text: ` what are the most valuable things we can set up for ${target} today?`,
    },
  ];
}

export function providerSegments({
  picksCount,
}: {
  picksCount: number;
}): TypeSegment[] {
  return [
    {
      text:
        picksCount > 1
          ? "Awesome! I'll help you set those up."
          : "Awesome! I'll help you set that up.",
      pauseAfter: 600,
    },
    {
      text: " First, please connect an AI provider you have access to so we can keep talking.",
    },
  ];
}

export const SKIP_TOUR_COPY = {
  link: "Skip Guided Tour",
  title: "Are you sure sure?",
  body: "It's much easier to get Langy to setup everything for you.",
  skip: "Skip anyway",
  keep: "Keep the guide",
} as const;

/** Next follows the greeting after this many ms: the words get a beat to themselves. */
export const NEXT_AFTER_TYPING_MS = 800;
