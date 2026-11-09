// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/organization-member-facts.feature
 */
import type { NurturingSignal, NurturingSignalOf } from "@langwatch/enterprise-nurturing-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { HttpCustomerIoChannel } from "../../channels/http/http.customer-io.channel.ts";
import { MemoryNurturingMilestonesRepository } from "../../repositories/memory/memory.nurturing-milestones.repository.ts";
import { MemoryNurturingProjectDirectoryRepository } from "../../repositories/memory/memory.nurturing-project-directory.repository.ts";
import type { NurturingClaimRepository } from "../../repositories/nurturing-claim.repository.ts";
import { NurturingDeliveryService } from "../nurturing-delivery.service.ts";
import { NurturingMemberFactsService } from "../nurturing-member-facts.service.ts";
import { NurturingService } from "../nurturing.service.ts";

const T0 = Date.UTC(2026, 9, 20, 12);
const seconds = (ms: number) => Math.floor(ms / 1000);

type Call = {
  path: string;
  userId: string;
  traits?: unknown;
  event?: unknown;
  properties?: unknown;
  messageId?: string;
};

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

/** How the first joined_organization request fails: a 500 reply, or a fetch that throws. */
type JoinedOrganizationFailure = "an HTTP 500" | "a network error";

/**
 * Customer.io over a recording fetch: a batch's items are unpacked into one call each. A failed
 * joined_organization request is not recorded, as Customer.io never took it.
 */
function customerIo({
  failFirstJoinedOrganization,
}: { failFirstJoinedOrganization?: JoinedOrganizationFailure } = {}) {
  const calls: Call[] = [];
  let batchRequests = 0;
  let failure = failFirstJoinedOrganization;
  const service = NurturingService.create({
    channel: HttpCustomerIoChannel.create({
      config: { customerIoApiKey: "key", customerIoRegion: "us" },
      fetchFn: async (url: string | URL | Request, init?: RequestInit) => {
        const path = new URL(url instanceof Request ? url.url : url).pathname;
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
        if (failure && path === "/v1/track" && body.event === "joined_organization") {
          const failed = failure;
          failure = undefined;
          if (failed === "a network error") throw new TypeError("fetch failed");
          return new Response("customer.io is down", { status: 500 });
        }
        if (path === "/v1/batch") {
          batchRequests += 1;
          for (const item of body.batch) calls.push({ path: `/v1/${item.type}`, ...item });
        } else {
          calls.push({ path, ...body });
        }
        return new Response(null, { status: 200 });
      },
    }),
  });
  return {
    service,
    calls,
    batchRequests: () => batchRequests,
    identifies: () => calls.filter((call) => call.path === "/v1/identify"),
    tracks: () => calls.filter((call) => call.path === "/v1/track"),
  };
}

async function settle(): Promise<void> {
  for (let tick = 0; tick < 5; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function organizationWithMembers({
  members = ["admin-1", "member-2"],
  placed = new Map([
    ["project-1", "org-1"],
    ["project-2", "org-1"],
    ["project-9", "org-9"],
  ]),
  traced = new Set<string>(),
  organizationsOfPerson = [],
  failFirstJoinedOrganization,
}: {
  members?: readonly string[];
  placed?: ReadonlyMap<string, string>;
  traced?: ReadonlySet<string>;
  organizationsOfPerson?: readonly string[];
  failFirstJoinedOrganization?: JoinedOrganizationFailure;
} = {}) {
  const claims = new ClockedClaims();
  const cio = customerIo({ failFirstJoinedOrganization });
  const milestones = MemoryNurturingMilestonesRepository.create();
  const projects = MemoryNurturingProjectDirectoryRepository.create({ placed, traced });
  const getAllMembers = vi.fn(async () => members.map((id) => ({ id })) as never);
  const organizationIdsForMember = vi.fn(async (input: { userId: string; activeOnly?: boolean }) =>
    input.activeOnly === false ? [...organizationsOfPerson] : [],
  );
  for (const organizationId of new Set(placed.values())) {
    await milestones.recordOrganization({ organizationId, adminUserId: "admin-1", seeded: false });
  }
  const memberFacts = NurturingMemberFactsService.create({
    claims,
    milestones,
    projects,
    organizations: createApiFixture<OrganizationApi>({ getAllMembers, organizationIdsForMember }),
  });
  const delivery = NurturingDeliveryService.create({
    claims,
    memberFacts,
    customerIo: cio.service,
    posthog: undefined,
    users: createApiFixture<UserApi>({
      findById: async () => ({ email: "jane@example.com", name: "Jane" }) as never,
    }),
  });
  const deliver = (signal: NurturingSignal) =>
    delivery.deliver({ key: `${signal.kind}:${signal.sourceEventId}`, signal });
  return { claims, cio, deliver, milestones, projects, getAllMembers, organizationIdsForMember };
}

const down = new Error("the database is down");
type Organization = Awaited<ReturnType<typeof organizationWithMembers>>;

const trace = (
  occurredAt: number,
  projectId = "project-1",
): NurturingSignalOf<"trace_received"> => ({
  kind: "trace_received",
  sourceEventId: `${projectId}:${occurredAt}`,
  tenantId: projectId,
  occurredAt,
  userId: "admin-1",
  projectId,
});
const firstTrace: NurturingSignal = {
  kind: "first_trace_integrated",
  sourceEventId: "first-1",
  tenantId: "project-1",
  occurredAt: T0,
  userId: "admin-1",
  projectId: "project-1",
  sdkLanguage: "python",
  sdkFramework: "unknown",
};
const session = (occurredAt: number): NurturingSignal => ({
  kind: "coding_session_stored",
  sourceEventId: `session:${occurredAt}`,
  tenantId: "project-1",
  occurredAt,
  userId: "admin-1",
  projectId: "project-1",
});
const agentTypes: NurturingSignal = {
  kind: "coding_agent_types",
  sourceEventId: "org-1:claude_code,codex",
  tenantId: "project-1",
  occurredAt: T0,
  userId: "admin-1",
  projectId: "project-1",
  agentTypes: ["claude_code", "codex"],
};
const firstSession: NurturingSignal = {
  kind: "coding_agent_first_session",
  sourceEventId: "org-1",
  tenantId: "project-1",
  occurredAt: T0,
  userId: "admin-1",
  projectId: "project-1",
  agentType: "claude_code",
  agentTypes: ["claude_code"],
  memberUserIds: ["admin-1", "member-2"],
};
const JOINED_AT = Temporal.Instant.from("2026-11-07T00:00:00Z").epochMilliseconds;
const joined = { tenantId: "org-1", occurredAt: JOINED_AT, userId: "joiner-1" };
const inviteAccepted: NurturingSignal = {
  kind: "invite_accepted",
  sourceEventId: "invite-1",
  ...joined,
  organizationId: "org-1",
  organizationName: "Acme",
};
const ssoAutoAdded: NurturingSignal = {
  kind: "sso_auto_added",
  sourceEventId: "sso-1",
  ...joined,
  organizationId: "org-1",
  organizationName: "Acme",
};
const signedUp: NurturingSignal = {
  kind: "signed_up",
  sourceEventId: "signup-1",
  ...joined,
  tenantId: "org-new",
  organizationId: "org-new",
  organizationName: "New",
};

const traitsOf = (calls: readonly Call[], userId: string) =>
  calls.filter((call) => call.userId === userId).map((call) => call.traits);

describe("NurturingDeliveryService organization facts", () => {
  describe("when a later trace is delivered", () => {
    /** @scenario "A later trace tells every active member last_trace_at and has_traces" */
    it("identifies every active member with has_traces and last_trace_at", async () => {
      const { cio, deliver } = await organizationWithMembers();

      await deliver(trace(T0 + 999));
      await settle();

      const traits = { has_traces: true, last_trace_at: seconds(T0) };
      expect(cio.identifies().map(({ userId }) => userId)).toEqual(["admin-1", "member-2"]);
      expect(traitsOf(cio.identifies(), "admin-1")).toEqual([traits]);
      expect(traitsOf(cio.identifies(), "member-2")).toEqual([traits]);
    });
  });

  describe("when a first trace is delivered", () => {
    /** @scenario "A first trace tells every active member and stays the admin's milestone" */
    it("tells member-2 the fact and keeps the SDK and the event the admin's", async () => {
      const { cio, deliver } = await organizationWithMembers();

      await deliver(firstTrace);
      await settle();

      expect(traitsOf(cio.identifies(), "member-2")).toEqual([
        { has_traces: true, last_trace_at: seconds(T0) },
      ]);
      expect(traitsOf(cio.identifies(), "admin-1")).toEqual([
        {
          has_traces: true,
          sdk_language: "python",
          sdk_framework: "unknown",
          first_trace_at: seconds(T0),
        },
        { has_traces: true, last_trace_at: seconds(T0) },
      ]);
      expect(cio.tracks().map(({ userId }) => userId)).toEqual(["admin-1"]);
    });
  });

  describe("when a coding session is delivered", () => {
    /** @scenario "A stored coding session tells every active member coding_last_session_at" */
    it("identifies every active member with coding_last_session_at", async () => {
      const { cio, deliver } = await organizationWithMembers();

      await deliver(session(T0));
      await settle();

      expect(cio.identifies()).toEqual([
        expect.objectContaining({
          userId: "admin-1",
          traits: { coding_last_session_at: seconds(T0) },
        }),
        expect.objectContaining({
          userId: "member-2",
          traits: { coding_last_session_at: seconds(T0) },
        }),
      ]);
    });
  });

  describe("when a new agent type is delivered", () => {
    /** @scenario "A new agent type tells every active member coding_agent_types" */
    it("identifies every active member with the full list", async () => {
      const { cio, deliver } = await organizationWithMembers();

      await deliver(agentTypes);
      await settle();

      const traits = { coding_agent_types: ["claude_code", "codex"] };
      expect(traitsOf(cio.identifies(), "admin-1")).toEqual([traits]);
      expect(traitsOf(cio.identifies(), "member-2")).toEqual([traits]);
    });
  });

  describe("when another coding fact of the organization is delivered", () => {
    const source = {
      sourceEventId: "org-1:1",
      tenantId: "project-1",
      occurredAt: T0,
      userId: "admin-1",
      projectId: "project-1",
    };

    /** @scenario "The terminal types, repo count and first-three-days count tell every active member" */
    it.each([
      [
        { ...source, kind: "coding_terminal_types", terminalTypes: ["vscode"] },
        { coding_terminal_types: ["vscode"] },
      ],
      [{ ...source, kind: "coding_repo_count", codingRepoCount: 2 }, { coding_repo_count: 2 }],
      [
        { ...source, kind: "coding_session_days_first_3", codingSessionDaysFirst3: 2 },
        { coding_session_days_first_3: 2 },
      ],
    ] satisfies [NurturingSignal, object][])(
      "identifies every active member with %j",
      async (signal, traits) => {
        const { cio, deliver } = await organizationWithMembers();

        await deliver(signal);
        await settle();

        expect(traitsOf(cio.identifies(), "admin-1")).toEqual([traits]);
        expect(traitsOf(cio.identifies(), "member-2")).toEqual([traits]);
      },
    );

    /** @scenario "The active days stay the admin's" */
    it("tells only the admin the active days", async () => {
      const { cio, deliver } = await organizationWithMembers();

      await deliver({ ...source, kind: "coding_active_days", codingActiveDays: 3 });
      await settle();

      expect(cio.identifies().map(({ userId }) => userId)).toEqual(["admin-1"]);
    });
  });

  describe("when the first coding session is delivered twice", () => {
    /** @scenario "The first coding session tells every member coding_first_session_at once" */
    it("tells member-2 the first session once and tracks only the admin", async () => {
      const { cio, deliver } = await organizationWithMembers();

      await deliver(firstSession);
      await deliver(firstSession);
      await settle();

      expect(traitsOf(cio.identifies(), "member-2")).toEqual([
        { coding_first_session_at: seconds(T0), coding_agent_types: ["claude_code"] },
        { uses_coding_agent: true },
      ]);
      expect(cio.tracks().map(({ userId }) => userId)).toEqual(["admin-1"]);
    });
  });

  describe("when a person joins an organization that already sent a trace", () => {
    /** @scenario "A member who joins by invite an organization with traces is told so" */
    it("identifies an invited person with has_traces and the current last_trace_at", async () => {
      const { cio, deliver } = await organizationWithMembers();
      await deliver(trace(T0));

      await deliver(inviteAccepted);
      await settle();

      expect(traitsOf(cio.identifies(), "joiner-1")).toEqual([
        { has_traces: true, last_trace_at: seconds(T0) },
      ]);
    });

    /** @scenario "A member who joins by SSO an organization with traces is not told false" */
    it("identifies an SSO person with has_traces and keeps the other milestones false", async () => {
      const { cio, deliver } = await organizationWithMembers();
      await deliver(trace(T0));

      await deliver(ssoAutoAdded);
      await settle();

      expect(traitsOf(cio.identifies(), "joiner-1")).toEqual([
        expect.objectContaining({
          has_traces: true,
          last_trace_at: seconds(T0),
          has_evaluations: false,
        }),
      ]);
    });

    /** @scenario "A member who joins an organization whose traces predate the stored time gets has_traces alone" */
    it("sends has_traces without a time when only project's table knows of traces", async () => {
      const { cio, deliver } = await organizationWithMembers({ traced: new Set(["project-2"]) });

      await deliver(ssoAutoAdded);
      await settle();

      const [traits] = traitsOf(cio.identifies(), "joiner-1");
      expect(traits).toMatchObject({ has_traces: true });
      expect(traits).not.toHaveProperty("last_trace_at");
    });
  });

  describe("when a person joins an organization", () => {
    const joinedOrganizations = (cio: Organization["cio"]) =>
      cio.tracks().filter(({ event }) => event === "joined_organization");

    /** @scenario "A join is tracked as joined_organization beside its own event" */
    it("tracks joined_organization with the join method and a stable message id", async () => {
      const { cio, deliver } = await organizationWithMembers();

      await deliver(ssoAutoAdded);
      await settle();

      expect(joinedOrganizations(cio)).toEqual([
        expect.objectContaining({
          messageId: "joined_organization:joiner-1:org-1",
          properties: expect.objectContaining({ join_method: "sso", organization_id: "org-1" }),
        }),
      ]);
    });

    /** @scenario "A redelivered or replayed join is tracked once" */
    it("tracks joined_organization once when the same invite is replayed after the delivery window", async () => {
      const { cio, claims, deliver } = await organizationWithMembers();

      await deliver(inviteAccepted);
      claims.now += 8 * 24 * 60 * 60 * 1000;
      await deliver(inviteAccepted);
      await settle();

      expect(joinedOrganizations(cio)).toHaveLength(1);
    });

    /** @scenario "An invite and an SSO add of the same person and organization are tracked once" */
    it("tracks joined_organization once for an invite and an SSO add of the same organization", async () => {
      const { cio, deliver } = await organizationWithMembers();

      await deliver(inviteAccepted);
      await deliver(ssoAutoAdded);
      await settle();

      expect(cio.tracks().map(({ event }) => event)).toEqual([
        "joined_organization",
        "joined_via_invite",
        "joined_via_sso",
      ]);
    });

    /** @scenario "A person joining a second organization is tracked joined_organization again" */
    it("tracks joined_organization again when the same person joins another organization", async () => {
      const { cio, deliver } = await organizationWithMembers();

      await deliver(inviteAccepted);
      await deliver({
        ...inviteAccepted,
        sourceEventId: "invite-2",
        tenantId: "org-2",
        organizationId: "org-2",
      });
      await settle();

      expect(joinedOrganizations(cio).map(({ messageId }) => messageId)).toEqual([
        "joined_organization:joiner-1:org-1",
        "joined_organization:joiner-1:org-2",
      ]);
    });

    /** @scenario "A joined_organization that failed to send is tracked when the same join is replayed" */
    it.each(["an HTTP 500", "a network error"] as const)(
      "gives the slot back when Customer.io answers the track with %s, so a replay of the same invite sends it once",
      async (failure) => {
        const { cio, deliver } = await organizationWithMembers({
          failFirstJoinedOrganization: failure,
        });
        const events = () => cio.tracks().map(({ event }) => event);

        await deliver(inviteAccepted);
        await settle();
        expect(events()).toEqual(["joined_via_invite"]);

        await deliver(inviteAccepted);
        await deliver(inviteAccepted);
        await settle();

        expect(events()).toEqual(["joined_via_invite", "joined_organization"]);
      },
    );

    /** @scenario "A join from before joined_organization existed is not tracked as it" */
    it("does not track joined_organization for a join that predates it", async () => {
      const { cio, deliver } = await organizationWithMembers();

      await deliver({ ...inviteAccepted, occurredAt: T0 });
      await settle();

      expect(cio.tracks().map(({ event }) => event)).toEqual(["joined_via_invite"]);
    });
  });

  describe("when a person joins an organization with no traces", () => {
    /** @scenario "An invite into an organization with no traces says nothing about traces" */
    it("sends no has_traces for an invite", async () => {
      const { cio, deliver } = await organizationWithMembers();

      await deliver(inviteAccepted);
      await settle();

      expect(cio.identifies()).toEqual([]);
      expect(cio.tracks().map(({ event }) => event)).toEqual([
        "joined_organization",
        "joined_via_invite",
      ]);
    });

    /** @scenario "A person with no traces anywhere still starts at has_traces false" */
    it("starts an SSO person at has_traces false", async () => {
      const { cio, deliver } = await organizationWithMembers();

      await deliver(ssoAutoAdded);
      await settle();

      expect(traitsOf(cio.identifies(), "joiner-1")).toEqual([
        expect.objectContaining({ has_traces: false }),
      ]);
    });

    /** @scenario "A person with no traces anywhere still starts at has_traces false" */
    it("starts a person signing up at has_traces false", async () => {
      const { cio, deliver } = await organizationWithMembers();

      await deliver(signedUp);
      await settle();

      expect(traitsOf(cio.identifies(), "joiner-1")).toEqual([
        expect.objectContaining({ has_traces: false }),
      ]);
    });
  });

  describe("when a person who belongs to an organization with traces signs up another", () => {
    /** @scenario "Signing up never overwrites has_traces true with false" */
    it("identifies them with has_traces true and that organization's last_trace_at", async () => {
      const { cio, deliver } = await organizationWithMembers({
        organizationsOfPerson: ["org-1", "org-new"],
      });
      await deliver(trace(T0));

      await deliver(signedUp);
      await settle();

      expect(traitsOf(cio.identifies(), "joiner-1")).toEqual([
        expect.objectContaining({ has_traces: true, last_trace_at: seconds(T0) }),
      ]);
    });
  });

  describe("when the only organization with traces was disabled for a person the SSO adds elsewhere", () => {
    /** @scenario "A disabled membership still counts toward has_traces" */
    it("identifies them with has_traces true", async () => {
      const { cio, deliver } = await organizationWithMembers({ organizationsOfPerson: ["org-1"] });
      await deliver(trace(T0));

      await deliver({ ...ssoAutoAdded, organizationId: "org-new" });
      await settle();

      expect(traitsOf(cio.identifies(), "joiner-1")).toEqual([
        expect.objectContaining({ has_traces: true }),
      ]);
    });
  });

  describe("when two projects of one organization send traces inside 300 seconds", () => {
    /** @scenario "A busy organization sends one batch per debounce window" */
    it("identifies each member once", async () => {
      const { claims, cio, deliver } = await organizationWithMembers();

      await deliver(trace(T0));
      claims.now = T0 + 100_000;
      await deliver(trace(T0 + 100_000, "project-2"));
      claims.now = T0 + 299_000;
      await deliver(trace(T0 + 299_000));
      await settle();

      expect(cio.identifies().map(({ userId }) => userId)).toEqual(["admin-1", "member-2"]);
    });

    it("identifies each member again with the later time after 301 seconds", async () => {
      const { claims, cio, deliver } = await organizationWithMembers();

      await deliver(trace(T0));
      claims.now = T0 + 301_000;
      await deliver(trace(T0 + 301_000));
      await settle();

      expect(traitsOf(cio.identifies(), "member-2")).toEqual([
        { has_traces: true, last_trace_at: seconds(T0) },
        { has_traces: true, last_trace_at: seconds(T0 + 301_000) },
      ]);
    });

    it("counts the first trace in the same window", async () => {
      const { cio, deliver } = await organizationWithMembers();

      await deliver(firstTrace);
      await deliver(trace(T0 + 1_000, "project-2"));
      await settle();

      expect(traitsOf(cio.identifies(), "member-2")).toHaveLength(1);
    });

    /** @scenario "A trace the organization's window drops still moves the stored time" */
    it("gives a person joining afterwards the later time", async () => {
      const { claims, cio, deliver } = await organizationWithMembers();

      await deliver(trace(T0));
      claims.now = T0 + 100_000;
      await deliver(trace(T0 + 100_000, "project-2"));
      await deliver(inviteAccepted);
      await settle();

      expect(traitsOf(cio.identifies(), "joiner-1")).toEqual([
        { has_traces: true, last_trace_at: seconds(T0 + 100_000) },
      ]);
    });
  });

  describe("when two organizations send traces inside 300 seconds", () => {
    it("tells the members of each", async () => {
      const { cio, deliver } = await organizationWithMembers();

      await deliver(trace(T0));
      await deliver(trace(T0, "project-9"));
      await settle();

      expect(cio.identifies()).toHaveLength(4);
    });
  });

  describe("when a read fails before the members are told", () => {
    const failingReads: [string, (organization: Organization) => void][] = [
      [
        "getPlacement",
        ({ projects }) => vi.spyOn(projects, "getPlacement").mockRejectedValueOnce(down),
      ],
      [
        "recordLastTrace",
        ({ milestones }) => vi.spyOn(milestones, "recordLastTrace").mockRejectedValueOnce(down),
      ],
      ["getAllMembers", ({ getAllMembers }) => getAllMembers.mockRejectedValueOnce(down)],
    ];

    /** @scenario "A read that fails before the members are told loses nothing on the retry" */
    it.each(failingReads)(
      "sends the fact once on the retry after %s fails",
      async (_read, failOnce) => {
        const organization = await organizationWithMembers();
        const { cio, deliver } = organization;
        failOnce(organization);

        await expect(deliver(firstTrace)).rejects.toThrow(down);
        await settle();
        expect(cio.calls).toEqual([]);

        await deliver(firstTrace);
        await settle();

        const fact = { has_traces: true, last_trace_at: seconds(T0) };
        expect(traitsOf(cio.identifies(), "member-2")).toEqual([fact]);
        expect(traitsOf(cio.identifies(), "admin-1")).toEqual([expect.anything(), fact]);
        expect(cio.tracks().map(({ event }) => event)).toEqual(["first_trace_integrated"]);
      },
    );

    /** @scenario "A later trace whose member read fails gives back its windows" */
    it("gives back the project's and the organization's windows", async () => {
      const { cio, deliver, getAllMembers } = await organizationWithMembers();
      getAllMembers.mockRejectedValueOnce(down);

      await expect(deliver(trace(T0))).rejects.toThrow(down);
      await deliver(trace(T0));
      await deliver(trace(T0));
      await settle();

      expect(cio.identifies().map(({ userId }) => userId)).toEqual(["admin-1", "member-2"]);
    });
  });

  describe("when a person's trace lookup fails", () => {
    const expectNoTraceTraits = (traits: unknown) => {
      expect(traits).not.toHaveProperty("has_traces");
      expect(traits).not.toHaveProperty("last_trace_at");
    };

    /** @scenario "A person signing up whose trace lookup fails still gets their profile" */
    it("identifies a person signing up with their email and no trace traits", async () => {
      const { cio, deliver, organizationIdsForMember } = await organizationWithMembers();
      organizationIdsForMember.mockRejectedValue(down);

      await deliver(signedUp);
      await settle();

      const [traits] = traitsOf(cio.identifies(), "joiner-1");
      expect(traits).toMatchObject({ email: "jane@example.com", has_evaluations: false });
      expectNoTraceTraits(traits);
      expect(cio.tracks().map(({ event }) => event)).toEqual(["signed_up"]);
    });

    /** @scenario "An invited person whose trace lookup fails still joins" */
    it("tracks an invited person's join and says nothing of traces", async () => {
      const { cio, deliver, organizationIdsForMember } = await organizationWithMembers();
      organizationIdsForMember.mockRejectedValue(down);

      await deliver(inviteAccepted);
      await settle();

      expect(cio.identifies()).toEqual([]);
      expect(cio.tracks().map(({ event }) => event)).toEqual([
        "joined_organization",
        "joined_via_invite",
      ]);
    });

    /** @scenario "An SSO person whose trace lookup fails still starts their milestones" */
    it("starts an SSO person's milestones with no trace traits", async () => {
      const { cio, deliver, organizationIdsForMember } = await organizationWithMembers();
      organizationIdsForMember.mockRejectedValue(down);

      await deliver(ssoAutoAdded);
      await settle();

      const [traits] = traitsOf(cio.identifies(), "joiner-1");
      expect(traits).toMatchObject({ has_evaluations: false });
      expectNoTraceTraits(traits);
      expect(cio.tracks().map(({ event }) => event)).toEqual([
        "joined_organization",
        "joined_via_sso",
      ]);
    });
  });

  describe("when an organization of 250 members sends a trace", () => {
    /** @scenario "A large organization's members go out in batches of one hundred" */
    it("sends three batch requests holding every member", async () => {
      const members = Array.from({ length: 250 }, (_, index) => `member-${index}`);
      const { cio, deliver } = await organizationWithMembers({ members });

      await deliver(trace(T0));
      await settle();

      expect(cio.batchRequests()).toBe(3);
      expect(new Set(cio.identifies().map(({ userId }) => userId))).toEqual(new Set(members));
    });
  });

  describe("when the admin a signal names is no longer an active member", () => {
    /** @scenario "Removed and deactivated members get nothing" */
    it.each([
      ["trace_received", trace(T0)],
      ["coding_session_stored", session(T0)],
      ["coding_agent_types", agentTypes],
    ] as const)("%s identifies only the active members", async (_kind, signal) => {
      const { cio, deliver } = await organizationWithMembers({ members: ["member-2"] });

      await deliver(signal);
      await settle();

      expect(cio.identifies().map(({ userId }) => userId)).toEqual(["member-2"]);
    });
  });

  describe("when the owners hold no organization for the project", () => {
    /** @scenario "A project its owners do not place tells only the admin it names" */
    it("identifies only the admin the signal names", async () => {
      const { cio, deliver } = await organizationWithMembers({ placed: new Map() });

      await deliver(trace(T0));
      await settle();

      expect(cio.identifies().map(({ userId }) => userId)).toEqual(["admin-1"]);
    });
  });
});
