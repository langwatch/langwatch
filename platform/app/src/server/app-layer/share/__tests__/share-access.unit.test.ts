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
    findShareLinks: vi.fn(async ({ projectId, tokens, links }) =>
      rows.filter(
        (row) =>
          row.projectId === projectId &&
          tokens.includes(TOKEN) &&
          links.some(
            (link) =>
              link.id === row.resourceId &&
              link.kind === (row.resourceType === "TRACE" ? "trace" : "thread"),
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
     * The walk reaches the resource tier LAST, so an ordinary binding on the
     * resource's lineage answers a resource-scope check before the token is
     * ever consulted. Honouring that would hand a member a link its own expiry
     * had killed, and would spend a view against a token that granted nothing.
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
  });

  describe("given a project-visibility link", () => {
    /**
     * The collector's KNOWN NARROWING (C5): the engine's `project` audience
     * resolves through PROJECT-scoped bindings alone, and almost nobody has
     * one — project access arrives as a TEAM binding. So the seam asks the
     * SAME engine the project-tier question the path it replaces asked, which
     * is what keeps a "Members of this project" link working.
     */
    /** @scenario A project link requires a member of the same project */
    it("grants a member who reaches the project through their team", async () => {
      const reader = readerWithLinks([buildLink({ visibility: "PROJECT" })]);
      vi.mocked(reader.findOrganizationMembership).mockResolvedValue({
        role: "MEMBER",
        disabled: false,
      });
      vi.mocked(reader.findUserBindings).mockResolvedValue([
        {
          role: "MEMBER",
          customRoleId: null,
          scopeType: "TEAM",
          scopeId: TEAM_ID,
        },
      ]);

      const outcome = await presentToken(deciderOver(reader), {
        principal: { type: "user", id: "user_1" },
      });

      expect(outcome).toEqual({ allowed: true, via: "project-audience" });
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
     * The compensation widens the AUDIENCE and nothing else: it runs only
     * behind a live grant the collector still returns, so a project member
     * cannot read past a link's own expiry.
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
