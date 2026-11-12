import { githubProgressFromToolParts, type LangyMessagePart } from "@langwatch/langy-contract";
import { z } from "zod";

const PULL_REQUEST_URL = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)$/;

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
    const match = PULL_REQUEST_URL.exec(event.url);
    if (!match?.[1] || !match[2]) continue;
    const pull = { repositoryFullName: match[1], prNumber: Number(match[2]) };
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

/** A pull request a conversation opened: repository lowercased, and when the answer landed. */
export const langyOpenedPullRequestSchema = z.object({
  repositoryFullName: z.string(),
  prNumber: z.number().int(),
  linkedAt: z.number(),
});

/**
 * The conversation's fold: the pull requests it opened and the CI follow-ups since the person
 * last spoke.
 */
export type LangyConversationPullRequestsData = {
  PullRequests: z.infer<typeof langyOpenedPullRequestSchema>[];
  FollowUpsInARow: number;
  CreatedAt: number;
  UpdatedAt: number;
  LastEventOccurredAt: number;
};

/** Adds the pull requests an answer opened, each once, keeping when each was first linked. */
export function withPullRequestsOpened(
  state: LangyConversationPullRequestsData,
  { parts, at }: { parts: readonly LangyMessagePart[]; at: number },
): LangyConversationPullRequestsData {
  const known = new Set(state.PullRequests.map(pullRequestKeyOf));
  const added = pullRequestsOpenedIn(parts)
    .map((pull) => ({
      repositoryFullName: pull.repositoryFullName.toLowerCase(),
      prNumber: pull.prNumber,
      linkedAt: at,
    }))
    .filter((pull) => !known.has(pullRequestKeyOf(pull)));
  if (added.length === 0) return state;
  return { ...state, PullRequests: [...state.PullRequests, ...added] };
}

/** A CI follow-up message counts one more in a row; a message the person sent starts again. */
export function withUserMessage(
  state: LangyConversationPullRequestsData,
  { isCiFollowUp }: { isCiFollowUp: boolean },
): LangyConversationPullRequestsData {
  return { ...state, FollowUpsInARow: isCiFollowUp ? state.FollowUpsInARow + 1 : 0 };
}
