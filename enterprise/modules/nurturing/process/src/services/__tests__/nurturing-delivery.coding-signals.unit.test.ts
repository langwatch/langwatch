// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/coding-agent-signals.feature
 * @see enterprise/modules/nurturing/specs/app-opened.feature
 */
import type { NurturingSignal, NurturingSignalOf } from "@langwatch/enterprise-nurturing-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { HttpCustomerIoChannel } from "../../channels/http/http.customer-io.channel.ts";
import { MemoryPostHogChannel } from "../../channels/memory/memory.posthog.channel.ts";
import { MemoryNurturingClaimRepository } from "../../repositories/memory/memory.nurturing.repositories.ts";
import type { NurturingClaimRepository } from "../../repositories/nurturing-claim.repository.ts";
import { NurturingDeliveryService } from "../nurturing-delivery.service.ts";
import { NurturingService } from "../nurturing.service.ts";

const T0 = Date.UTC(2026, 9, 20, 12);
const unixSeconds = (ms: number) => Math.floor(ms / 1000);

/** Customer.io over a recording fetch: each call is kept as its path and body. */
function customerIo() {
  const sent: { path: string; body: Record<string, unknown> }[] = [];
  const service = NurturingService.create({
    channel: HttpCustomerIoChannel.create({
      config: { customerIoApiKey: "key", customerIoRegion: "us" },
      fetchFn: async (url: string | URL | Request, init?: RequestInit) => {
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
        sent.push({ path: new URL(url instanceof Request ? url.url : url).pathname, body });
        return new Response(null, { status: 200 });
      },
    }),
  });
  return {
    service,
    identifies: () => sent.filter((call) => call.path === "/v1/identify").map((call) => call.body),
    tracks: () => sent.filter((call) => call.path === "/v1/track").map((call) => call.body),
  };
}

/** A claim repository whose clock the test moves, with the real window semantics. */
class ClockedClaims implements NurturingClaimRepository {
  now = T0;
  readonly #until = new Map<string, number>();
  async claim(key: string, ttlSeconds: number): Promise<boolean> {
    const until = this.#until.get(key);
    if (until !== undefined && until > this.now) return false;
    this.#until.set(key, this.now + ttlSeconds * 1000);
    return true;
  }
  async release(key: string): Promise<void> {
    this.#until.delete(key);
  }
}

function deliveryOver(claims: NurturingClaimRepository, cio = customerIo()) {
  const posthog = MemoryPostHogChannel.create();
  const delivery = NurturingDeliveryService.create({
    claims,
    users: createApiFixture<UserApi>({}),
    customerIo: cio.service,
    posthog,
  });
  return { delivery, cio, posthog };
}

async function settle(): Promise<void> {
  for (let tick = 0; tick < 3; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
}

const codingSource = { tenantId: "project-1", userId: "admin-1", projectId: "project-1" };
const sessionStored = (
  sourceEventId: string,
  occurredAt: number,
): NurturingSignalOf<"coding_session_stored"> => ({
  kind: "coding_session_stored",
  sourceEventId,
  occurredAt,
  ...codingSource,
});
const activeDays: NurturingSignal = {
  kind: "coding_active_days",
  sourceEventId: "org-1:2026-10-20",
  occurredAt: T0,
  ...codingSource,
  codingActiveDays: 3,
};
const agentTypes: NurturingSignal = {
  kind: "coding_agent_types",
  sourceEventId: "org-1:claude_code,codex",
  occurredAt: T0,
  ...codingSource,
  agentTypes: ["claude_code", "codex"],
};
const firstSession: NurturingSignal = {
  kind: "coding_agent_first_session",
  sourceEventId: "org-1",
  occurredAt: T0,
  ...codingSource,
  agentType: "claude_code",
  agentTypes: ["claude_code"],
  memberUserIds: [],
};
const appOpened = (occurredAt: number, userId = "user-1"): NurturingSignal => ({
  kind: "app_opened",
  sourceEventId: `${userId}:${occurredAt}`,
  tenantId: userId,
  userId,
  occurredAt,
  page: "me_sessions",
});
const pageViewed = (occurredAt: number, userId = "user-1"): NurturingSignal => ({
  kind: "sessions_page_viewed",
  sourceEventId: `${userId}:${occurredAt}`,
  tenantId: userId,
  userId,
  occurredAt,
  page: "me_sessions",
});

const deliver = (delivery: NurturingDeliveryService, signal: NurturingSignal): Promise<void> =>
  delivery.deliver({ key: `${signal.kind}:${signal.sourceEventId}`, signal });

describe("NurturingDeliveryService coding-agent signals", () => {
  describe("when a stored session is delivered", () => {
    /** @scenario "A stored session identifies coding_last_session_at on the admin" */
    it("identifies the admin with the session's time", async () => {
      const { delivery, cio } = deliveryOver(new ClockedClaims());

      await deliver(delivery, sessionStored("s-1", T0));
      await settle();

      expect(cio.identifies()).toEqual([
        expect.objectContaining({
          userId: "admin-1",
          traits: { coding_last_session_at: unixSeconds(T0) },
        }),
      ]);
    });
  });

  describe("when three sessions of one project are delivered inside 300 seconds", () => {
    let claims: ClockedClaims;
    let delivery: NurturingDeliveryService;
    let cio: ReturnType<typeof customerIo>;

    beforeEach(async () => {
      claims = new ClockedClaims();
      ({ delivery, cio } = deliveryOver(claims));
      await deliver(delivery, sessionStored("s-1", T0));
    });

    /** @scenario "Session updates to Customer.io are debounced per project for 300 seconds" */
    it("identifies once", async () => {
      claims.now = T0 + 100_000;
      await deliver(delivery, sessionStored("s-2", T0 + 100_000));
      claims.now = T0 + 299_000;
      await deliver(delivery, sessionStored("s-3", T0 + 299_000));
      await settle();

      expect(cio.identifies()).toHaveLength(1);
    });

    it("identifies again with the later time once 301 seconds have passed", async () => {
      claims.now = T0 + 301_000;
      await deliver(delivery, sessionStored("s-2", T0 + 301_000));
      await settle();

      expect(cio.identifies().map((call) => call.traits)).toEqual([
        { coding_last_session_at: unixSeconds(T0) },
        { coding_last_session_at: unixSeconds(T0 + 301_000) },
      ]);
    });
  });

  describe("when two projects deliver a session inside the same 300 seconds", () => {
    it("identifies for each project", async () => {
      const { delivery, cio } = deliveryOver(new ClockedClaims());

      await deliver(delivery, sessionStored("s-1", T0));
      await deliver(delivery, {
        ...sessionStored("s-2", T0),
        tenantId: "project-2",
        projectId: "project-2",
      });
      await settle();

      expect(cio.identifies()).toHaveLength(2);
    });
  });

  describe("when the active-day count is delivered", () => {
    /** @scenario "A later UTC day raises coding_active_days" */
    it("identifies the admin with the count", async () => {
      const { delivery, cio } = deliveryOver(new ClockedClaims());

      await deliver(delivery, activeDays);
      await settle();

      expect(cio.identifies()).toEqual([
        expect.objectContaining({ userId: "admin-1", traits: { coding_active_days: 3 } }),
      ]);
    });
  });

  describe("when a later agent type is delivered", () => {
    /** @scenario "A second agent type extends coding_agent_types without a first-session event" */
    it("identifies the full list and tracks nothing", async () => {
      const { delivery, cio } = deliveryOver(new ClockedClaims());

      await deliver(delivery, agentTypes);
      await settle();

      expect(cio.identifies()).toEqual([
        expect.objectContaining({
          traits: { coding_agent_types: ["claude_code", "codex"] },
        }),
      ]);
      expect(cio.tracks()).toEqual([]);
    });
  });

  describe("when the first session is delivered", () => {
    /** @scenario "The first coding-agent session identifies the admin and tracks one event" */
    it("identifies the first-session time and the agent types", async () => {
      const { delivery, cio } = deliveryOver(new ClockedClaims());

      await deliver(delivery, firstSession);
      await settle();

      expect(cio.identifies()).toEqual([
        expect.objectContaining({
          userId: "admin-1",
          traits: { coding_first_session_at: unixSeconds(T0), coding_agent_types: ["claude_code"] },
        }),
      ]);
    });

    it("tracks one coding_agent_first_session with the agent type", async () => {
      const { delivery, cio } = deliveryOver(new ClockedClaims());

      await deliver(delivery, firstSession);
      await settle();

      expect(cio.tracks()).toEqual([
        expect.objectContaining({
          userId: "admin-1",
          event: "coding_agent_first_session",
          properties: expect.objectContaining({ agent_type: "claude_code" }),
        }),
      ]);
    });

    /** @scenario "Every member of an organization that sends a coding-agent session gets uses_coding_agent in Customer.io" */
    it("identifies every member with uses_coding_agent, once per person", async () => {
      const { delivery, cio } = deliveryOver(new ClockedClaims());
      const withMembers = { ...firstSession, memberUserIds: ["admin-1", "member-2", "member-2"] };

      await deliver(delivery, withMembers);
      await deliver(delivery, withMembers);
      await settle();

      expect(
        cio
          .identifies()
          .filter((call) => JSON.stringify(call.traits) === '{"uses_coding_agent":true}')
          .map((call) => call.userId),
      ).toEqual(["admin-1", "member-2"]);
    });

    it("sends a member of two organizations the trait once", async () => {
      const { delivery, cio } = deliveryOver(new ClockedClaims());

      await deliver(delivery, { ...firstSession, memberUserIds: ["member-2"] });
      await deliver(delivery, {
        ...firstSession,
        sourceEventId: "org-2",
        memberUserIds: ["member-2"],
      });
      await settle();

      expect(
        cio.identifies().filter((call) => "uses_coding_agent" in (call.traits as object)),
      ).toHaveLength(1);
    });

    /** @scenario "A member who chose another integration method in onboarding keeps it" */
    it("leaves a member's onboarding integration_method and adds uses_coding_agent", async () => {
      const { delivery, cio } = deliveryOver(new ClockedClaims());

      await deliver(delivery, {
        kind: "integration_method_chosen",
        sourceEventId: "choice-1",
        tenantId: "member-2",
        occurredAt: T0 - 1_000,
        userId: "member-2",
        selection: "via-platform",
      });
      await deliver(delivery, { ...firstSession, memberUserIds: ["member-2"] });
      await settle();

      expect(
        cio
          .identifies()
          .filter((call) => call.userId === "member-2")
          .map((call) => call.traits),
      ).toEqual([{ integration_method: "platform" }, { uses_coding_agent: true }]);
    });

    /** @scenario "A member claim that fails never strands a member already claimed" */
    it("still identifies the first member when the second member's claim throws", async () => {
      const claims = new ClockedClaims();
      const claim = claims.claim.bind(claims);
      claims.claim = async (key, ttlSeconds) => {
        if (key.endsWith(":member-3")) throw new Error("redis down");
        return claim(key, ttlSeconds);
      };
      const { delivery, cio } = deliveryOver(claims);

      await expect(
        deliver(delivery, { ...firstSession, memberUserIds: ["member-2", "member-3"] }),
      ).rejects.toThrow("redis down");
      await settle();

      expect(
        cio
          .identifies()
          .filter((call) => "uses_coding_agent" in (call.traits as object))
          .map((call) => call.userId),
      ).toEqual(["member-2"]);
    });

    it("delivers a redelivered first-session signal once", async () => {
      const { delivery, cio } = deliveryOver(new ClockedClaims());

      await deliver(delivery, firstSession);
      await deliver(delivery, firstSession);
      await settle();

      expect(cio.tracks()).toHaveLength(1);
    });
  });
});

describe("NurturingDeliveryService app-open signals", () => {
  describe("when an app open is delivered", () => {
    /** @scenario "An app open identifies app_last_opened_at and tracks sessions_page_viewed on the opening user" */
    it("identifies the opening user with the open time", async () => {
      const { delivery, cio } = deliveryOver(new ClockedClaims());

      await deliver(delivery, appOpened(T0));
      await settle();

      expect(cio.identifies()).toEqual([
        expect.objectContaining({
          userId: "user-1",
          traits: { app_last_opened_at: unixSeconds(T0) },
        }),
      ]);
    });

    it("tracks sessions_page_viewed on the opening user", async () => {
      const { delivery, cio } = deliveryOver(new ClockedClaims());

      await deliver(delivery, pageViewed(T0));
      await settle();

      expect(cio.tracks()).toEqual([
        expect.objectContaining({ userId: "user-1", event: "sessions_page_viewed" }),
      ]);
    });
  });

  describe("when the same user opens the page twice inside an hour", () => {
    let claims: ClockedClaims;
    let delivery: NurturingDeliveryService;
    let cio: ReturnType<typeof customerIo>;

    beforeEach(async () => {
      claims = new ClockedClaims();
      ({ delivery, cio } = deliveryOver(claims));
      await deliver(delivery, appOpened(T0));
      await deliver(delivery, pageViewed(T0));
    });

    /** @scenario "Repeated opens inside an hour send once per user" */
    it("identifies once and tracks once", async () => {
      claims.now = T0 + 3_599_000;
      await deliver(delivery, appOpened(T0 + 3_599_000));
      await deliver(delivery, pageViewed(T0 + 3_599_000));
      await settle();

      expect([cio.identifies().length, cio.tracks().length]).toEqual([1, 1]);
    });

    it("sends both again after the hour", async () => {
      claims.now = T0 + 3_601_000;
      await deliver(delivery, appOpened(T0 + 3_601_000));
      await deliver(delivery, pageViewed(T0 + 3_601_000));
      await settle();

      expect([cio.identifies().length, cio.tracks().length]).toEqual([2, 2]);
    });
  });

  describe("when two users open the page in the same hour", () => {
    it("sends for each user", async () => {
      const { delivery, cio } = deliveryOver(new ClockedClaims());

      await deliver(delivery, pageViewed(T0, "user-1"));
      await deliver(delivery, pageViewed(T0, "user-2"));
      await settle();

      expect(cio.tracks()).toHaveLength(2);
    });
  });

  describe("when two pods share one claim repository", () => {
    /** @scenario "Two pods opening for one user send once" */
    it("tracks sessions_page_viewed once", async () => {
      const claims = MemoryNurturingClaimRepository.create();
      const cio = customerIo();
      const podA = deliveryOver(claims, cio).delivery;
      const podB = deliveryOver(claims, cio).delivery;

      await Promise.all([deliver(podA, pageViewed(T0)), deliver(podB, pageViewed(T0 + 5))]);
      await settle();

      expect(cio.tracks()).toHaveLength(1);
    });
  });
});

describe("NurturingDeliveryService PostHog for the new kinds", () => {
  const kinds: readonly [string, NurturingSignal][] = [
    ["coding_session_stored", sessionStored("s-1", T0)],
    ["coding_active_days", activeDays],
    ["coding_agent_types", agentTypes],
    ["coding_agent_first_session", firstSession],
    ["app_opened", appOpened(T0)],
    ["sessions_page_viewed", pageViewed(T0)],
  ];

  describe.each(kinds)("when %s is delivered", (_kind, signal) => {
    /** @scenario "The new signals reach Customer.io only" */
    it("sends PostHog nothing", async () => {
      const { delivery, posthog } = deliveryOver(new ClockedClaims());

      await deliver(delivery, signal);
      await settle();

      expect(posthog.tracked).toEqual([]);
    });
  });
});
