/**
 * ADR-092 §8 — the share path's decision, taken by the REAL engine.
 *
 * Nothing here mocks the decision. The suite composes the shipped
 * `AuthzService` over the shipped `AuthzCollectorService` and fakes only the
 * storage port beneath them, so every assertion runs the actual walk
 * (`resourceGrantStep`), the actual matcher (`matchResourceGrant`) and the
 * actual collector policy (possession, `isLiveShareLink`, the visibility →
 * audience mapping). A stubbed `authz.check` would have asserted the stub.
 *
 * @see specs/rbac/unified-authorization-engine.feature
 */
import {
  AuthzCollectorService,
  type AuthzReadRepository,
  AuthzService,
  type ShareLinkRow,
} from "@langwatch/authz-server";
import { describe, expect, it, vi } from "vitest";
import { engineShareAccessDecider } from "../share-access";

const ORG_ID = "org_1";
const TEAM_ID = "team_1";
const PROJECT_ID = "project_1";
const OTHER_PROJECT_ID = "project_2";
const TRACE_ID = "trace_a";
const TOKEN = "tok_abc";

function buildLink(overrides: Partial<ShareLinkRow> = {}): ShareLinkRow {
  return {
    resourceType: "TRACE",
    resourceId: TRACE_ID,
    projectId: PROJECT_ID,
    visibility: "PUBLIC",
    permission: null,
    expiresAt: null,
    maxViews: null,
    viewCount: 0,
    ...overrides,
  };
}

/**
 * A world with nothing in it: no membership, no bindings, no links. Each test
 * switches on only what its scenario needs, so the diff from nothing IS the
 * scenario. `findShareLinks` honours possession and the resource links the
 * way the real query must, because that is the property under test.
 */
function makeReader(
  overrides: Partial<AuthzReadRepository> = {},
): AuthzReadRepository {
  return {
    findOrganizationMembership: vi.fn().mockResolvedValue(null),
    findUserBindings: vi.fn().mockResolvedValue([]),
    findGroupBindings: vi.fn().mockResolvedValue([]),
    findApiKeyBindings: vi.fn().mockResolvedValue([]),
    findApiKeyOwner: vi.fn().mockResolvedValue(null),
    findLegacyTeamMemberships: vi.fn().mockResolvedValue([]),
    findCustomRolePermissions: vi.fn().mockResolvedValue([]),
    findShareLinks: vi.fn().mockResolvedValue([]),
    findProjectLineage: vi
      .fn()
      .mockResolvedValue({ teamId: TEAM_ID, organizationId: ORG_ID }),
    findTeamOrganization: vi.fn().mockResolvedValue({ organizationId: ORG_ID }),
    ...overrides,
  } as AuthzReadRepository;
}

/**
 * The store a real `findShareLinks` stands in front of: rows are returned only
 * when the caller PRESENTED the token and asked about a link the row sits at,
 * inside the project the query was fenced to. Anything looser here would let a
 * test pass for a reason production never reproduces.
 */
function readerWithLinks(rows: ShareLinkRow[]): AuthzReadRepository {
  return makeReader({
    findShareLinks: vi.fn(
      async ({
        projectId,
        tokens,
        links,
      }: Parameters<AuthzReadRepository["findShareLinks"]>[0]) =>
        rows.filter(
          (row) =>
            row.projectId === projectId &&
            tokens.includes(TOKEN) &&
            links.some(
              (link) =>
                link.id === row.resourceId &&
                link.kind ===
                  (row.resourceType === "TRACE" ? "trace" : "thread"),
            ),
        ),
    ),
  });
}

function deciderOver(reader: AuthzReadRepository) {
  const collector = new AuthzCollectorService(reader);
  return engineShareAccessDecider({
    authz: new AuthzService(collector),
    scopes: collector,
  });
}

function presentToken(
  decider: ReturnType<typeof deciderOver>,
  overrides: Partial<Parameters<typeof decider.decide>[0]> = {},
) {
  return decider.decide({
    principal: { type: "anonymous" },
    permission: "traces:view",
    projectId: PROJECT_ID,
    resourceType: "TRACE",
    resourceId: TRACE_ID,
    token: TOKEN,
    ...overrides,
  });
}

describe("engineShareAccessDecider", () => {
  describe("given a live public link for the trace being read", () => {
    /** @scenario A share link decides through the engine's resource tier */
    it("is granted through the resource tier, not some other step", async () => {
      const outcome = await presentToken(
        deciderOver(readerWithLinks([buildLink()])),
      );

      expect(outcome).toEqual({ allowed: true, via: "resource-grant" });
    });
  });

  describe("given the token is never presented", () => {
    /** @scenario A share link that is not presented grants nothing */
    it("reaches no grant, because possession is what activates one", async () => {
      const reader = readerWithLinks([buildLink()]);
      const decider = deciderOver(reader);

      const outcome = await presentToken(decider, { token: "tok_other" });

      expect(outcome.allowed).toBe(false);
      // The token rides the scope: a read the caller did not present for
      // cannot even match the row.
      expect(reader.findShareLinks).toHaveBeenCalledWith(
        expect.objectContaining({ tokens: ["tok_other"] }),
      );
    });
  });

  describe("given a link that is expired or out of views", () => {
    /** @scenario Expired and view-exhausted share links grant nothing */
    it.each([
      ["expired", { expiresAt: new Date(Date.now() - 1000) }],
      ["view-exhausted", { maxViews: 1, viewCount: 1 }],
    ])("refuses a %s link", async (_label, overrides) => {
      const outcome = await presentToken(
        deciderOver(readerWithLinks([buildLink(overrides)])),
      );

      expect(outcome.allowed).toBe(false);
    });
  });

  describe("given a link for a different trace in the same project", () => {
    /** @scenario A share link covers the trace it names and no other */
    it("refuses the trace the link does not name", async () => {
      const outcome = await presentToken(
        deciderOver(readerWithLinks([buildLink({ resourceId: "trace_b" })])),
      );

      expect(outcome.allowed).toBe(false);
    });
  });

  describe("given the same trace id exists in another project", () => {
    /** @scenario Resource grants are anchored to their project */
    it("refuses the other project's trace, token and id notwithstanding", async () => {
      const outcome = await presentToken(
        deciderOver(readerWithLinks([buildLink()])),
        { projectId: OTHER_PROJECT_ID },
      );

      expect(outcome.allowed).toBe(false);
    });
  });

  describe("given the link's stored permission does not cover the read", () => {
    /**
     * Nothing on the hand-rolled path ever read this column, so this outcome
     * exists only because the engine decides: `matchResourceGrant` tests the
     * row's own permission against the one being asked for.
     */
    /** @scenario A share link grants only what it says it grants */
    it("refuses a link that confers something else entirely", async () => {
      const outcome = await presentToken(
        deciderOver(
          readerWithLinks([buildLink({ permission: "datasets:view" })]),
        ),
      );

      expect(outcome.allowed).toBe(false);
    });

    it("grants a link whose permission covers the read and more", async () => {
      const outcome = await presentToken(
        deciderOver(
          readerWithLinks([buildLink({ permission: "annotations:create" })]),
        ),
      );

      expect(outcome).toEqual({ allowed: true, via: "resource-grant" });
    });
  });

  describe("given a project member who did not present a live link", () => {
    /**
     * The collector filters a dead link out before the walk sees it, so the
     * resource tier has nothing to answer with and the member's own binding on
     * the resource's lineage answers instead — `via: "binding"`. Honouring
     * that here would hand a member a link its own expiry had killed, and
     * would spend a view against a token that granted nothing. Only the tier
     * redeems a token; a binding never does.
     */
    /** @scenario A member's own access never redeems a dead share link */
    it("refuses: a binding is not the redemption of a token", async () => {
      const reader = readerWithLinks([
        buildLink({ expiresAt: new Date(Date.now() - 1000) }),
      ]);
      vi.mocked(reader.findOrganizationMembership).mockResolvedValue({
        role: "MEMBER",
        disabled: false,
      });
      vi.mocked(reader.findUserBindings).mockResolvedValue([
        {
          role: "ADMIN",
          customRoleId: null,
          scopeType: "TEAM",
          scopeId: TEAM_ID,
        },
      ]);

      const outcome = await presentToken(deciderOver(reader), {
        principal: { type: "user", id: "user_1" },
      });

      expect(outcome.allowed).toBe(false);
    });
  });

  describe("given an organization-visibility link", () => {
    /** @scenario An organization link requires a member of the same organization */
    it("grants a member of that organization", async () => {
      const reader = readerWithLinks([
        buildLink({ visibility: "ORGANIZATION" }),
      ]);
      vi.mocked(reader.findOrganizationMembership).mockResolvedValue({
        role: "MEMBER",
        disabled: false,
      });

      const outcome = await presentToken(deciderOver(reader), {
        principal: { type: "user", id: "user_1" },
      });

      expect(outcome).toEqual({ allowed: true, via: "resource-grant" });
    });

    it("refuses an anonymous holder of the leaked link", async () => {
      const outcome = await presentToken(
        deciderOver(
          readerWithLinks([buildLink({ visibility: "ORGANIZATION" })]),
        ),
      );

      expect(outcome.allowed).toBe(false);
    });

    /**
     * Membership, not a binding: an organization audience is every member of
     * it, which is the floor legacy applied at organization scope. Someone
     * signed in elsewhere holds no membership here and so is in no audience,
     * whatever bindings the snapshot found.
     */
    /** @scenario An organization audience is every member and nobody else */
    it("refuses a signed-in member of another organization", async () => {
      const reader = readerWithLinks([
        buildLink({ visibility: "ORGANIZATION" }),
      ]);
      vi.mocked(reader.findOrganizationMembership).mockResolvedValue(null);

      const outcome = await presentToken(deciderOver(reader), {
        principal: { type: "user", id: "user_1" },
      });

      expect(outcome.allowed).toBe(false);
    });

    /** @scenario An organization audience is every member and nobody else */
    it("grants a member holding no binding anywhere", async () => {
      const reader = readerWithLinks([
        buildLink({ visibility: "ORGANIZATION" }),
      ]);
      vi.mocked(reader.findOrganizationMembership).mockResolvedValue({
        role: "MEMBER",
        disabled: false,
      });
      vi.mocked(reader.findUserBindings).mockResolvedValue([]);

      const outcome = await presentToken(deciderOver(reader), {
        principal: { type: "user", id: "user_1" },
      });

      expect(outcome).toEqual({ allowed: true, via: "resource-grant" });
    });
  });

  describe("given a project-visibility link", () => {
    /**
     * A member of a project holds, in practice, a binding somewhere on its
     * lineage — usually the TEAM that owns it, rarely the project itself,
     * sometimes the organization above. The audience is that whole chain, so
     * all three open the link, and all three do it through the resource tier:
     * there is no second question asked behind the engine's answer any more.
     */
    /** @scenario A project audience reaches everyone who reaches the project */
    it.each([
      ["the project itself", "PROJECT" as const, PROJECT_ID],
      ["the team that owns it", "TEAM" as const, TEAM_ID],
      ["the organization above it", "ORGANIZATION" as const, ORG_ID],
    ])("grants a member bound at %s", async (_label, scopeType, scopeId) => {
      const reader = readerWithLinks([buildLink({ visibility: "PROJECT" })]);
      vi.mocked(reader.findOrganizationMembership).mockResolvedValue({
        role: "MEMBER",
        disabled: false,
      });
      vi.mocked(reader.findUserBindings).mockResolvedValue([
        { role: "MEMBER", customRoleId: null, scopeType, scopeId },
      ]);

      const outcome = await presentToken(deciderOver(reader), {
        principal: { type: "user", id: "user_1" },
      });

      expect(outcome).toEqual({ allowed: true, via: "resource-grant" });
    });

    it("refuses someone outside the project", async () => {
      const reader = readerWithLinks([buildLink({ visibility: "PROJECT" })]);
      vi.mocked(reader.findOrganizationMembership).mockResolvedValue({
        role: "MEMBER",
        disabled: false,
      });

      const outcome = await presentToken(deciderOver(reader), {
        principal: { type: "user", id: "user_1" },
      });

      expect(outcome.allowed).toBe(false);
    });

    /**
     * The widening the reachability chain does is bounded by the chain: a
     * sibling team in the same organization is not on the shared project's
     * lineage, so its members are not in the audience — which is the whole
     * point of resolving the audience rather than settling for "an org
     * member is near enough".
     */
    /** @scenario A project audience stops at the project's own lineage */
    it("refuses a member of a different project in the same organization", async () => {
      const reader = readerWithLinks([buildLink({ visibility: "PROJECT" })]);
      vi.mocked(reader.findOrganizationMembership).mockResolvedValue({
        role: "ADMIN",
        disabled: false,
      });
      vi.mocked(reader.findUserBindings).mockResolvedValue([
        {
          role: "ADMIN",
          customRoleId: null,
          scopeType: "TEAM",
          scopeId: "team_2",
        },
      ]);

      const outcome = await presentToken(deciderOver(reader), {
        principal: { type: "user", id: "user_1" },
      });

      expect(outcome.allowed).toBe(false);
    });

    /**
     * The membership lookup is fenced to the resource's organization, so
     * somebody else's admin arrives here holding nothing at all. The leftover
     * binding is belt and braces: an audience is a membership set, and a
     * caller with no live membership is in none of them.
     */
    /** @scenario A project audience stops at the project's own lineage */
    it("refuses a member of a different organization entirely", async () => {
      const reader = readerWithLinks([buildLink({ visibility: "PROJECT" })]);
      vi.mocked(reader.findOrganizationMembership).mockResolvedValue(null);
      vi.mocked(reader.findUserBindings).mockResolvedValue([
        {
          role: "ADMIN",
          customRoleId: null,
          scopeType: "TEAM",
          scopeId: TEAM_ID,
        },
      ]);

      const outcome = await presentToken(deciderOver(reader), {
        principal: { type: "user", id: "user_1" },
      });

      expect(outcome.allowed).toBe(false);
    });

    /**
     * Reachability decides the AUDIENCE and nothing else. Every other gate is
     * still the collector's and the engine's, so a member on the chain cannot
     * read past the link's own expiry.
     */
    /** @scenario A member's own access never redeems a dead share link */
    it("refuses a member once the project link itself expired", async () => {
      const reader = readerWithLinks([
        buildLink({
          visibility: "PROJECT",
          expiresAt: new Date(Date.now() - 1000),
        }),
      ]);
      vi.mocked(reader.findOrganizationMembership).mockResolvedValue({
        role: "MEMBER",
        disabled: false,
      });
      vi.mocked(reader.findUserBindings).mockResolvedValue([
        {
          role: "ADMIN",
          customRoleId: null,
          scopeType: "TEAM",
          scopeId: TEAM_ID,
        },
      ]);

      const outcome = await presentToken(deciderOver(reader), {
        principal: { type: "user", id: "user_1" },
      });

      expect(outcome.allowed).toBe(false);
    });
  });

  describe("given a project that no longer exists", () => {
    it("refuses without asking the engine anything", async () => {
      const reader = makeReader({
        findProjectLineage: vi.fn().mockResolvedValue(null),
      });

      const outcome = await presentToken(deciderOver(reader));

      expect(outcome.allowed).toBe(false);
      expect(reader.findShareLinks).not.toHaveBeenCalled();
    });
  });
});
