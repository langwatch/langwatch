import { describe, expect, it } from "vitest";
import {
  guidedPathCompletedIn,
  guidedPathInProgress,
  guidedPullRequestFromMessages,
  isGuidedConversation,
} from "../guidedConversation";
import { GUIDED_ONBOARDING_KICKOFF_PART_TYPE } from "../kickoff";

/**
 * @see specs/langy/langy-guided-onboarding.feature
 */
const kickoff = {
  role: "user",
  parts: [
    {
      type: GUIDED_ONBOARDING_KICKOFF_PART_TYPE,
      path: "llmops",
      paths: ["llmops"],
      orgName: "ACME",
      tourStatus: "completed",
    },
  ],
};

const bash = (command: string, output = "ok", state = "output-available") => ({
  type: "tool-bash",
  toolCallId: `call-${command.length}`,
  state,
  input: { command },
  output,
});

const completePath = bash("langwatch onboarding complete-path llmops");

describe("isGuidedConversation", () => {
  it("is true once a user message carries the kickoff", () => {
    expect(isGuidedConversation([kickoff])).toBe(true);
    expect(
      isGuidedConversation([
        { role: "user", parts: [{ type: "text", text: "hi" }] },
      ]),
    ).toBe(false);
  });
});

describe("guidedPathCompletedIn", () => {
  it("reads the settled complete-path call, as a shell call or as the typed name", () => {
    expect(guidedPathCompletedIn([completePath])).toBe(true);
    expect(
      guidedPathCompletedIn([
        {
          type: "tool-langwatch.onboarding.complete-path",
          state: "output-available",
          input: { command: "langwatch onboarding complete-path llmops" },
        },
      ]),
    ).toBe(true);
  });

  it("ignores a call still running, a failed one, and other commands", () => {
    expect(
      guidedPathCompletedIn([
        bash(
          "langwatch onboarding complete-path llmops",
          "",
          "input-available",
        ),
      ]),
    ).toBe(false);
    expect(
      guidedPathCompletedIn([
        bash(
          "langwatch onboarding complete-path llmops",
          "err",
          "output-error",
        ),
      ]),
    ).toBe(false);
    expect(guidedPathCompletedIn([bash("langwatch scenario run s_1")])).toBe(
      false,
    );
  });
});

describe("guidedPathInProgress", () => {
  /** @scenario "No feedback ask while the guided path runs" */
  it("holds from the kickoff until a reply closes the path", () => {
    expect(guidedPathInProgress([kickoff])).toBe(true);
    expect(
      guidedPathInProgress([
        kickoff,
        { role: "assistant", parts: [bash("langwatch scenario run s_1")] },
      ]),
    ).toBe(true);
    expect(
      guidedPathInProgress([
        kickoff,
        { role: "assistant", parts: [completePath] },
      ]),
    ).toBe(false);
  });

  it("is false for a conversation with no kickoff", () => {
    expect(
      guidedPathInProgress([
        { role: "user", parts: [{ type: "text", text: "hi" }] },
        { role: "assistant", parts: [{ type: "text", text: "hello" }] },
      ]),
    ).toBe(false);
  });
});

describe("guidedPullRequestFromMessages", () => {
  /** @scenario "The pull request card closes the path" */
  it("reads the branch, the title and the address off the tool calls", () => {
    const pr = guidedPullRequestFromMessages([
      kickoff,
      {
        role: "assistant",
        parts: [
          bash("git fetch origin && git checkout -b langy/tracing origin/main"),
          bash(
            'git add app/graph.py && git commit -m "Add LangWatch tracing and the connect endpoint"',
          ),
          bash("git push -u origin HEAD"),
          bash(
            'gh pr create --base main --title "Add LangWatch tracing and the connect endpoint" --body-file .langwatch/pr-body.md',
            "https://github.com/acme/checkout/pull/12\n",
          ),
        ],
      },
    ]);
    expect(pr).toEqual({
      branch: "langy/tracing",
      title: "Add LangWatch tracing and the connect endpoint",
      url: "https://github.com/acme/checkout/pull/12",
    });
  });

  it("keeps the branch alone when no pull request was opened", () => {
    expect(
      guidedPullRequestFromMessages([
        {
          role: "assistant",
          parts: [bash("git checkout -b langy/tracing")],
        },
      ]),
    ).toEqual({ branch: "langy/tracing" });
    expect(
      guidedPullRequestFromMessages([
        {
          role: "assistant",
          parts: [
            bash(
              "git worktree add ../checkout-langy -b langy/tracing origin/main",
            ),
          ],
        },
      ]),
    ).toEqual({ branch: "langy/tracing" });
  });

  it("never reads a pull request off a failed create, and is null with no branch", () => {
    expect(
      guidedPullRequestFromMessages([
        {
          role: "assistant",
          parts: [
            bash(
              'gh pr create --title "x"',
              "https://github.com/acme/checkout/pull/12",
              "output-error",
            ),
          ],
        },
      ]),
    ).toBeNull();
    expect(guidedPullRequestFromMessages([kickoff])).toBeNull();
  });
});
