/**
 * Every connected source's condition, as one chip.
 *
 * The Directory page names each source separately, because an administrator
 * with two of them needs to know WHICH one stopped. The Authentication
 * overview is answering a smaller question — is provisioning working at all —
 * and one summary chip is the honest size of that answer.
 *
 * A source that has ENDED and a source that needs attention collapse into the
 * same word on purpose. They differ in what happened and not in what to do,
 * and a summary that read "Syncing" while one source had stopped would be the
 * one failure this chip exists to catch.
 *
 * Framework-free, so the words can be pinned by a test that renders nothing.
 */

export type DirectorySyncTone = "neutral" | "good" | "warning" | "bad";

export interface DirectorySyncChip {
  label: string;
  tone: DirectorySyncTone;
  /** The longer explanation, on hover. */
  title: string;
}

export function directorySyncChipFor(
  sources: Array<{ status: { tone: string } }>,
): DirectorySyncChip {
  if (sources.length === 0) {
    return {
      label: "Not set up yet",
      tone: "neutral",
      title: "No identity provider creates people here yet.",
    };
  }
  const tones = new Set(sources.map((source) => source.status.tone));
  if (tones.has("attention") || tones.has("ended")) {
    return {
      label: "Needs attention",
      tone: "warning",
      title:
        "One of your sources has stopped or has something it could not apply. Open Directory to see which.",
    };
  }
  if (tones.has("waiting")) {
    return {
      label: "Waiting for the first push",
      tone: "neutral",
      title: "Nothing has arrived from your identity provider yet.",
    };
  }
  return {
    label: "Syncing",
    tone: "good",
    title: "Your identity provider is creating and updating people here.",
  };
}
