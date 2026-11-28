import {
  githubProgressFromToolParts,
  pullRequestUrlsIn,
  type LangyMessagePart,
} from "@langwatch/langy-contract";
import { Temporal } from "@langwatch/time";

/** The most automatic follow-ups CI may start in a row on a pull request before a person speaks. */
export const LANGY_CI_FOLLOW_UPS_IN_A_ROW = 3;

/**
 * The pull requests a turn opened: only a successful `gh pr create` call counts, read from the
 * URL it printed. A URL printed by any other command opens nothing.
 */
export function pullRequestsOpenedIn(
  parts: readonly LangyMessagePart[],
): { repositoryFullName: string; prNumber: number }[] {
  const opened = new Map<string, { repositoryFullName: string; prNumber: number }>();
  for (const event of githubProgressFromToolParts(parts)) {
    if (event.stage !== "opened" || !event.url) continue;
    const [url] = pullRequestUrlsIn(event.url);
    if (!url || url.url !== event.url) continue;
    const pull = { repositoryFullName: url.repositoryFullName, prNumber: url.number };
    opened.set(`${pull.repositoryFullName.toLowerCase()}#${pull.prNumber}`, pull);
  }
  return [...opened.values()];
}

/**
 * The message an automatic follow-up turn starts with. It says who started it, what CI
 * reported and which follow-up in a row it is, so Langy can judge whether to go on.
 */
export function ciFollowUpMessage(input: {
  repositoryFullName: string;
  prNumber: number;
  headBranch: string;
  headSha: string;
  conclusion: "success" | "failure";
  failedChecks: readonly { name: string; conclusion: string; url: string | null }[];
  followUpNumber: number;
}): string {
  const failed = input.failedChecks.map(
    (check) => `- ${check.name}: ${check.conclusion}${check.url ? ` (${check.url})` : ""}`,
  );
  return [
    `Automatic follow-up ${input.followUpNumber} of at most ${LANGY_CI_FOLLOW_UPS_IN_A_ROW} in a row, ` +
      "started by LangWatch, not typed by the person: CI finished on a pull request you opened.",
    `Pull request: ${input.repositoryFullName}#${input.prNumber}, branch ${input.headBranch}, ` +
      `commit ${input.headSha.slice(0, 12)}.`,
    `Conclusion: ${input.conclusion === "success" ? "every check passed" : "checks failed"}.`,
    ...(failed.length > 0 ? ["Checks that did not pass:", ...failed] : []),
    "Read the result. If a check failed because of your change, fix it on the same branch and " +
      "push; if the run measured something, report what it measured. If there is nothing to do, " +
      "or the failure is not yours to fix, say so and stop. Push only to this branch.",
  ].join("\n");
}

/** One pull request on one repository as a key; the repository name is matched without case. */
export function pullRequestKeyOf(key: { repositoryFullName: string; prNumber: number }): string {
  return `${key.repositoryFullName.toLowerCase()}#${key.prNumber}`;
}

/** The pull requests one answer opened, repository lowercased: what the read model stores. */
export type LangyPullRequestsOpenedRecord = {
  ConversationId: string;
  PullRequests: { repositoryFullName: string; prNumber: number }[];
  /** When the answer was recorded (epoch ms). */
  OpenedAt: number;
  SourceEventId: string;
};

/** The pull requests an answer opened, as the record the read model stores; none is empty. */
export function pullRequestsOpenedRecordOf(answer: {
  id: string;
  occurredAt: number;
  data: { conversationId: string; parts: readonly LangyMessagePart[] };
}): LangyPullRequestsOpenedRecord {
  return {
    ConversationId: answer.data.conversationId,
    PullRequests: pullRequestsOpenedIn(answer.data.parts).map((pull) => ({
      repositoryFullName: pull.repositoryFullName.toLowerCase(),
      prNumber: pull.prNumber,
    })),
    OpenedAt: answer.occurredAt,
    SourceEventId: answer.id,
  };
}

/** The prompt note for a person past the per-day pull request cap: refuse to open another. */
export function langyPrCapReachedNote({
  perDayPrCap,
  resetAt,
}: {
  perDayPrCap: number;
  resetAt: number;
}): string {
  return [
    "",
    "USER PR CAP REACHED — the user has already opened the per-day maximum",
    "of",
    String(perDayPrCap),
    "GitHub pull requests via Langy today.",
    "If the user asks you to open a PR, refuse politely, say the daily cap",
    "is reached, and that it resets at",
    Temporal.Instant.fromEpochMilliseconds(resetAt).toString({ fractionalSecondDigits: 3 }),
    "UTC.",
    "Do not call any tool that opens a PR.",
  ].join(" ");
}
