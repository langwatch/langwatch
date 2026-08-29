import {
  AuthzEngine,
  type CollectedGrants,
  type ResourceGrant,
} from "@langwatch/authz-contract";
import { describe, expect, it } from "vitest";
import {
  binding,
  grantOn,
  makeGrants,
  ORG,
  PROJECT,
  TEAM,
  traceScope,
} from "./support/resource-fixtures";

const engine = new AuthzEngine();

describe("resource-tier grants (ADR-092 §8)", () => {
  describe("given trace t1 is shared with anyone", () => {
    const resourceGrants = [grantOn()];

    it("grants an anonymous caller traces:view on t1, marked public", () => {
      const decision = engine.decide({
        grants: makeGrants(),
        permission: "traces:view",
        scope: traceScope(),
        resourceGrants,
      });
      expect(decision.allowed).toBe(true);
      expect(decision.via).toBe("resource-grant");
      expect(decision.audience).toBe("public");
    });

    /** @scenario "A share token grants exactly one permission on exactly one resource" */
    it("denies the same caller on a different trace in the same project", () => {
      const decision = engine.decide({
        grants: makeGrants(),
        permission: "traces:view",
        scope: traceScope({ id: "trace-2" }),
        resourceGrants,
      });
      expect(decision.allowed).toBe(false);
      expect(decision.denialReason).toBe("no-membership");
    });

    it("denies a permission the grant does not carry", () => {
      const decision = engine.decide({
        grants: makeGrants(),
        permission: "traces:update",
        scope: traceScope(),
        resourceGrants,
      });
      expect(decision.allowed).toBe(false);
    });

    /** @scenario "Resource grants are anchored to their project" */
    it("denies a same-id trace anchored to a different project", () => {
      const decision = engine.decide({
        grants: makeGrants(),
        permission: "traces:view",
        scope: traceScope({
          projectId: "proj-other",
          teamId: "team-other",
        }),
        resourceGrants,
      });
      expect(decision.allowed).toBe(false);
    });

    it("keeps a project member on the binding path, audience member", () => {
      const decision = engine.decide({
        grants: makeGrants({
          principal: { type: "user", id: "user-1" },
          organizationRole: "MEMBER",
          bindings: [binding({ scopeType: "PROJECT", scopeId: PROJECT })],
        }),
        permission: "traces:view",
        scope: traceScope(),
        resourceGrants,
      });
      expect(decision.allowed).toBe(true);
      expect(decision.via).toBe("binding");
      expect(decision.audience).toBe("member");
    });
  });

  describe("given a shared thread and a trace inside it", () => {
    const resourceGrants = [grantOn({ kind: "thread", id: "thread-1" })];

    /** @scenario "A shared thread covers the traces beneath it" */
    it("covers the trace through its parent link — one grant, no child rows", () => {
      const decision = engine.decide({
        grants: makeGrants(),
        permission: "traces:view",
        scope: traceScope({
          parents: [{ kind: "thread", id: "thread-1" }],
        }),
        resourceGrants,
      });
      expect(decision.allowed).toBe(true);
      expect(decision.via).toBe("resource-grant");
    });

    it("does not cover a trace outside the thread", () => {
      const decision = engine.decide({
        grants: makeGrants(),
        permission: "traces:view",
        scope: traceScope(),
        resourceGrants,
      });
      expect(decision.allowed).toBe(false);
    });
  });

  describe("when a grant names each audience kind", () => {
    const checkWith = ({
      audience,
      grants,
    }: {
      audience: ResourceGrant["audience"];
      grants: CollectedGrants;
    }) =>
      engine.decide({
        grants,
        permission: "traces:view",
        scope: traceScope(),
        resourceGrants: [grantOn({ audience })],
      });

    /** @scenario "A resource grant can name any audience" */
    it("user: matches only that signed-in user", () => {
      const audience = { kind: "user", id: "user-1" } as const;
      const dave = makeGrants({ principal: { type: "user", id: "user-1" } });
      const other = makeGrants({ principal: { type: "user", id: "user-2" } });
      expect(checkWith({ audience, grants: dave }).allowed).toBe(true);
      expect(checkWith({ audience, grants: dave }).audience).toBe("member");
      expect(checkWith({ audience, grants: other }).allowed).toBe(false);
      expect(checkWith({ audience, grants: makeGrants() }).allowed).toBe(false);
    });

    it("apiKey: matches only that key principal", () => {
      const audience = { kind: "apiKey", id: "key-1" } as const;
      const key = makeGrants({ principal: { type: "apiKey", id: "key-1" } });
      const other = makeGrants({ principal: { type: "apiKey", id: "key-2" } });
      expect(checkWith({ audience, grants: key }).allowed).toBe(true);
      expect(checkWith({ audience, grants: other }).allowed).toBe(false);
    });

    it("team: matches a member of that team, via binding or legacy row", () => {
      const audience = { kind: "team", id: TEAM } as const;
      const viaBinding = makeGrants({
        principal: { type: "user", id: "user-1" },
        bindings: [binding({ scopeType: "TEAM", scopeId: TEAM })],
      });
      const viaLegacy = makeGrants({
        principal: { type: "user", id: "user-1" },
        legacyTeamMemberships: [
          {
            teamId: TEAM,
            role: "VIEWER",
            customRoleId: null,
            isPersonal: false,
          },
        ],
      });
      const otherTeam = makeGrants({
        principal: { type: "user", id: "user-2" },
        bindings: [binding({ scopeType: "TEAM", scopeId: "team-other" })],
      });
      expect(checkWith({ audience, grants: viaBinding }).allowed).toBe(true);
      expect(checkWith({ audience, grants: viaLegacy }).allowed).toBe(true);
      expect(checkWith({ audience, grants: otherTeam }).allowed).toBe(false);
    });

    it("project: matches a caller with a binding on that project", () => {
      const audience = { kind: "project", id: PROJECT } as const;
      const member = makeGrants({
        principal: { type: "user", id: "user-1" },
        bindings: [binding({ scopeType: "PROJECT", scopeId: PROJECT })],
      });
      expect(checkWith({ audience, grants: member }).allowed).toBe(true);
      expect(checkWith({ audience, grants: makeGrants() }).allowed).toBe(false);
    });

    it("organization: matches any org member and nobody else", () => {
      const audience = { kind: "organization", id: ORG } as const;
      const member = makeGrants({
        principal: { type: "user", id: "user-1" },
        organizationRole: "MEMBER",
      });
      const outsider = makeGrants({
        principal: { type: "user", id: "user-2" },
      });
      expect(checkWith({ audience, grants: member }).allowed).toBe(true);
      expect(checkWith({ audience, grants: outsider }).allowed).toBe(false);
      expect(checkWith({ audience, grants: makeGrants() }).allowed).toBe(false);
    });

    it("group: matches a caller holding a binding via that group", () => {
      const audience = { kind: "group", id: "group-1" } as const;
      const member = makeGrants({
        principal: { type: "user", id: "user-1" },
        bindings: [
          binding({
            scopeType: "PROJECT",
            scopeId: "proj-other",
            viaGroupId: "group-1",
          }),
        ],
      });
      expect(checkWith({ audience, grants: member }).allowed).toBe(true);
      expect(checkWith({ audience, grants: makeGrants() }).allowed).toBe(false);
    });
  });

  describe("when the scope is not a resource", () => {
    it("ignores resource grants entirely", () => {
      const decision = engine.decide({
        grants: makeGrants(),
        permission: "traces:view",
        scope: {
          type: "project",
          id: PROJECT,
          teamId: TEAM,
          organizationId: ORG,
        },
        resourceGrants: [grantOn()],
      });
      expect(decision.allowed).toBe(false);
    });
  });

  describe("when the grant and the scope disagree on kind", () => {
    it("a trace grant never covers a thread of the same id", () => {
      const decision = engine.decide({
        grants: makeGrants(),
        permission: "traces:view",
        scope: traceScope({ kind: "thread", id: "x" }),
        resourceGrants: [grantOn({ id: "x" })],
      });
      expect(decision.allowed).toBe(false);
    });
  });
});
