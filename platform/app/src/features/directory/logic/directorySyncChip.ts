/** The least healthy source determines the directory overview's status. */

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
      label: "Waiting for directory changes",
      tone: "neutral",
      title: "Waiting for your identity provider to send a directory change.",
    };
  }
  return {
    label: "Syncing",
    tone: "good",
    title: "Your identity provider is creating and updating people here.",
  };
}

/**
 * How many directories are connected, and what colour that number should be.
 *
 * A count alone answers half the question. "Provisioning 2" tells an
 * administrator there are two connections and nothing about whether either is
 * working — and the tab is closed, so the colour is the only channel left
 * before they open it. So the number is the count and the tone is the worst
 * condition among them, which is the one worth knowing first.
 *
 * The tone deliberately follows the same worst-wins rule as the summary chip
 * above: a badge that reads green while one of two connections has stopped is
 * the exact failure both of these exist to catch.
 *
 * `undefined` count while the read is in flight, so the badge draws nothing
 * rather than a zero it has not confirmed.
 */
export function directoryConnectionsBadge(
  sources: Array<{ status: { tone: string } }> | undefined,
): { count: number | undefined; tone: DirectorySyncTone; title: string } {
  if (sources === undefined) {
    return { count: undefined, tone: "neutral", title: "" };
  }
  if (sources.length === 0) {
    return {
      count: 0,
      tone: "neutral",
      title: "No identity provider is connected yet.",
    };
  }

  const noun = sources.length === 1 ? "connection" : "connections";
  const tones = new Set(sources.map((source) => source.status.tone));

  if (tones.has("attention") || tones.has("ended")) {
    return {
      count: sources.length,
      tone: "warning",
      title: `${sources.length} ${noun}, at least one of which has stopped or has something it could not apply.`,
    };
  }
  if (tones.has("waiting")) {
    return {
      count: sources.length,
      tone: "neutral",
      title: `${sources.length} ${noun}, at least one waiting for directory changes.`,
    };
  }
  return {
    count: sources.length,
    tone: "good",
    title: `${sources.length} ${noun}, all syncing.`,
  };
}
