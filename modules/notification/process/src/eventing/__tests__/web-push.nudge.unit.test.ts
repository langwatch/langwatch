/**
 * @vitest-environment node
 * A send is picked up without waiting for the outbox poll: the queue wakes its outbox once
 * per enqueue that stored something, and never for sends it already held.
 * Spec: modules/notification/specs/web-push.feature
 */
import { InMemoryProcessStore } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";

import type { WebPushSend } from "../../services/web-push.service.ts";
import { OutboxWebPushQueue } from "../web-push.pipeline.ts";
import { WEB_PUSH_PROCESS_NAME } from "../web-push.process.ts";

const sendFor = ({ subscriptionId }: { subscriptionId: string }): WebPushSend => ({
  subscriptionId,
  topic: "topic-marker",
  urgency: "high",
  ttlSeconds: 86_400,
  message: { title: "title-marker", body: "body-marker", url: "/", tag: "tag-marker" },
});

const sendsFor = ({ keys }: { keys: readonly string[] }) =>
  keys.map((key) => ({ messageKey: key, send: sendFor({ subscriptionId: key }) }));

describe("OutboxWebPushQueue wakes its outbox", () => {
  /** @scenario "An enqueue that stores a send wakes the outbox once" */
  it("once for an enqueue that stored two sends", async () => {
    const notifyOutbox = vi.fn();
    const queue = OutboxWebPushQueue.create(InMemoryProcessStore.createForTesting(), notifyOutbox);

    const result = await queue.enqueue({
      userId: "user_ada",
      projectId: "project_1",
      sends: sendsFor({ keys: ["fact:a", "fact:b"] }),
    });

    expect(result.queued).toBe(2);
    expect(notifyOutbox).toHaveBeenCalledTimes(1);
    expect(notifyOutbox).toHaveBeenCalledWith(WEB_PUSH_PROCESS_NAME);
  });

  /** @scenario "An enqueue of sends already stored does not wake the outbox" */
  it("not for sends it already held", async () => {
    const notifyOutbox = vi.fn();
    const queue = OutboxWebPushQueue.create(InMemoryProcessStore.createForTesting(), notifyOutbox);
    const input = {
      userId: "user_ada",
      projectId: "project_1",
      sends: sendsFor({ keys: ["fact:a"] }),
    };
    await queue.enqueue(input);
    notifyOutbox.mockClear();

    const again = await queue.enqueue(input);

    expect(again.queued).toBe(0);
    expect(notifyOutbox).not.toHaveBeenCalled();
  });

  it("enqueues without a nudge where the process supplies none", async () => {
    const queue = OutboxWebPushQueue.create(InMemoryProcessStore.createForTesting());

    const result = await queue.enqueue({
      userId: "user_ada",
      projectId: "project_1",
      sends: sendsFor({ keys: ["fact:a"] }),
    });

    expect(result.queued).toBe(1);
  });
});
