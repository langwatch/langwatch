import { describe, expect, it } from "vitest";
import {
  handleAgentResponded,
  handleAgentResponseFailed,
  handleAgentTurnAccepted,
  handleArchived,
  handleHandoffConsumed,
  handleHandoffPending,
  handleMetadataUpdated,
  handleTitleGenerated,
  initLangyConversationProcessState,
} from "./langyConversation.process";

const ctx = { processKey: "conv-1" };

describe("when the agent turn is accepted", () => {
  it("marks the turn running and dispatches exactly one worker-dispatch intent", () => {
    const step = handleAgentTurnAccepted(
      initLangyConversationProcessState(),
      { turnId: "turn-1" },
      ctx,
    );

    expect(step.state).toMatchObject({ currentTurnId: "turn-1", turnStatus: "running" });
    expect(step.intents).toEqual([
      {
        type: "workerDispatch",
        payload: { conversationId: "conv-1", turnId: "turn-1", resumeFromTurnId: null },
      },
    ]);
  });

  it("never replaces a turn already running under a different id", () => {
    const running = {
      ...initLangyConversationProcessState(),
      currentTurnId: "turn-1",
      turnStatus: "running" as const,
    };

    const step = handleAgentTurnAccepted(running, { turnId: "turn-2" }, ctx);

    expect(step.state).toBe(running);
    expect(step.intents).toEqual([]);
  });

  it("does nothing once the conversation is archived", () => {
    const archived = { ...initLangyConversationProcessState(), archived: true };

    const step = handleAgentTurnAccepted(archived, { turnId: "turn-1" }, ctx);

    expect(step.state).toBe(archived);
    expect(step.intents).toEqual([]);
  });
});

describe("when the agent responds", () => {
  it("requests a title on the first successful response while still derived", () => {
    const running = {
      ...initLangyConversationProcessState(),
      currentTurnId: "turn-1",
      turnStatus: "running" as const,
    };

    const step = handleAgentResponded(
      running,
      { turnId: "turn-1", outcome: "completed" },
      ctx,
    );

    expect(step.state).toMatchObject({
      currentTurnId: null,
      turnStatus: "completed",
      autoTitleRequested: true,
    });
    expect(step.intents).toEqual([
      { type: "generateTitle", payload: { conversationId: "conv-1", turnId: "turn-1" } },
    ]);
  });

  it("never requests a second automatic title", () => {
    const alreadyRequested = {
      ...initLangyConversationProcessState(),
      currentTurnId: "turn-2",
      turnStatus: "running" as const,
      autoTitleRequested: true,
    };

    const step = handleAgentResponded(
      alreadyRequested,
      { turnId: "turn-2", outcome: "completed" },
      ctx,
    );

    expect(step.intents).toEqual([]);
  });

  it("ignores a response for a turn that is not the current one", () => {
    const running = {
      ...initLangyConversationProcessState(),
      currentTurnId: "turn-1",
      turnStatus: "running" as const,
    };

    const step = handleAgentResponded(
      running,
      { turnId: "stale-turn", outcome: "completed" },
      ctx,
    );

    expect(step.state).toBe(running);
  });

  it("marks the turn failed without requesting a title on a failed outcome", () => {
    const running = {
      ...initLangyConversationProcessState(),
      currentTurnId: "turn-1",
      turnStatus: "running" as const,
    };

    const step = handleAgentResponded(
      running,
      { turnId: "turn-1", outcome: "failed" },
      ctx,
    );

    expect(step.state).toMatchObject({ turnStatus: "failed" });
    expect(step.intents).toEqual([]);
  });
});

describe("when the response fails outright", () => {
  it("clears the current turn and marks it failed", () => {
    const running = {
      ...initLangyConversationProcessState(),
      currentTurnId: "turn-1",
      turnStatus: "running" as const,
    };

    const step = handleAgentResponseFailed(running, { turnId: "turn-1" });

    expect(step.state).toMatchObject({ currentTurnId: null, turnStatus: "failed" });
  });
});

describe("when the conversation is archived", () => {
  it("clears the running turn and marks the process archived", () => {
    const running = {
      ...initLangyConversationProcessState(),
      currentTurnId: "turn-1",
      turnStatus: "running" as const,
    };

    const step = handleArchived(running);

    expect(step.state).toMatchObject({
      archived: true,
      currentTurnId: null,
      turnStatus: "idle",
    });
  });
});

describe("when the title source changes", () => {
  it("makes a user rename sticky", () => {
    const step = handleMetadataUpdated(initLangyConversationProcessState(), {
      title: "My conversation",
    });

    expect(step.state.titleSource).toBe("user");
  });

  it("leaves the title source untouched when the update carries no title", () => {
    const state = initLangyConversationProcessState();
    const step = handleMetadataUpdated(state, {});

    expect(step.state).toBe(state);
  });

  it("marks a generated title auto, unless the user already renamed", () => {
    const derived = handleTitleGenerated(initLangyConversationProcessState());
    expect(derived.state.titleSource).toBe("auto");

    const userState = { ...initLangyConversationProcessState(), titleSource: "user" as const };
    const stillUser = handleTitleGenerated(userState);
    expect(stillUser.state.titleSource).toBe("user");
  });
});

describe("when a turn hands off and resumes", () => {
  it("returns to idle and remembers the handed-off turn", () => {
    const running = {
      ...initLangyConversationProcessState(),
      currentTurnId: "turn-1",
      turnStatus: "running" as const,
    };

    const pending = handleHandoffPending(running, { turnId: "turn-1" });
    expect(pending.state).toMatchObject({
      currentTurnId: null,
      turnStatus: "idle",
      pendingHandoffTurnId: "turn-1",
    });

    const consumed = handleHandoffConsumed(pending.state);
    expect(consumed.state.pendingHandoffTurnId).toBeNull();
  });
});
