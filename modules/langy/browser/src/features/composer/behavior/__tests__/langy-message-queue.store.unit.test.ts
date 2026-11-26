/**
 * @see modules/langy/specs/langy-queue-while-busy.feature
 */
import { beforeEach, describe, expect, it } from "vitest";

import { useLangyStore } from "../../../../behavior/langy.store.ts";
import {
  isQueueHeld,
  type LangyQueuedMessage,
  useLangyMessageQueue,
} from "../langy-message-queue.store.ts";

const queued = (id: string, conversationId: string | null): LangyQueuedMessage => ({
  id,
  conversationId,
  text: `message ${id}`,
  images: [],
});

beforeEach(() => {
  useLangyMessageQueue.setState({ messages: [], held: {} });
});

describe("useLangyMessageQueue", () => {
  /** @scenario Queued messages go as one follow-up turn when the turn ends */
  it("hands a conversation's messages back in order and leaves the queue empty", () => {
    const queue = useLangyMessageQueue.getState();
    queue.enqueue(queued("a", "conv-1"));
    queue.enqueue(queued("b", "conv-2"));
    queue.enqueue(queued("c", "conv-1"));

    expect(queue.takeAll("conv-1").map((message) => message.id)).toEqual(["a", "c"]);
    expect(useLangyMessageQueue.getState().messages.map((message) => message.id)).toEqual(["b"]);
  });

  /** @scenario A queued message can be removed */
  it("takes one message out by id", () => {
    const queue = useLangyMessageQueue.getState();
    queue.enqueue(queued("a", "conv-1"));
    queue.enqueue(queued("b", "conv-1"));

    expect(queue.takeOne("a")?.text).toBe("message a");
    expect(useLangyMessageQueue.getState().messages.map((message) => message.id)).toEqual(["b"]);
  });

  /** @scenario A queued message waits for its own conversation */
  it("moves messages and their hold to the conversation that got an id", () => {
    const queue = useLangyMessageQueue.getState();
    queue.enqueue(queued("a", null));
    queue.hold(null);

    queue.adopt("conv-new");

    const state = useLangyMessageQueue.getState();
    expect(state.messages[0]?.conversationId).toBe("conv-new");
    expect(isQueueHeld({ held: state.held, conversationId: "conv-new" })).toBe(true);
    expect(isQueueHeld({ held: state.held, conversationId: null })).toBe(false);
  });

  /** @scenario Queued messages outlive closing and reopening the panel */
  it("keeps queued messages when the panel closes and opens again", () => {
    useLangyMessageQueue.getState().enqueue(queued("a", "conv-1"));

    useLangyStore.getState().closePanel();
    useLangyStore.getState().togglePanel();

    expect(useLangyMessageQueue.getState().messages.map((message) => message.id)).toEqual(["a"]);
  });
});
