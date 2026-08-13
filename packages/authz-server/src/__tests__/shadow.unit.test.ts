import type { CollectedBinding } from "@langwatch/authz";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthzCollectorService } from "../authz-collector.service";
import type { AuthzReadRepository } from "../authz-read.repository";
import { makeReader } from "./support/authz-read.stub";

const { warn, debug } = vi.hoisted(() => ({
  warn: vi.fn(),
  debug: vi.fn(),
}));
vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ warn, debug, info: vi.fn(), error: vi.fn() }),
}));

import { AuthzShadowService } from "../authz-shadow.service";

const ORG = "org-1";
const TEAM = "team-1";
const PROJECT = "proj-1";
const LINEAGE = { teamId: TEAM, organizationId: ORG };

const projectBinding = (role: CollectedBinding["role"]): CollectedBinding[] => [
  {
    role,
    customRoleId: null,
    scopeType: "PROJECT",
    scopeId: PROJECT,
    viaGroupId: null,
  },
];

function makeShadowReader(overrides: Partial<AuthzReadRepository> = {}) {
  return makeReader({
    findProjectLineage: vi.fn().mockResolvedValue(LINEAGE),
    ...overrides,
  });
}

function makeShadow(
  reader: AuthzReadRepository,
  { sampleRate = 1 }: { sampleRate?: number } = {},
) {
  return new AuthzShadowService(new AuthzCollectorService(reader), {
    sampleRate: () => sampleRate,
    demoProjectId: () => undefined,
  });
}

/**
 * The comparison is fire-and-forget, so "it stayed silent" needs a real
 * finish line: a deferred the LAST stubbed read resolves, followed by a
 * macrotask boundary, which the whole microtask tail of the comparison
 * drains before.
 */
function readCompletionSignal() {
  let seen: () => void = () => undefined;
  const reached = new Promise<void>((resolve) => {
    seen = resolve;
  });
  return {
    reached,
    markSeen: seen,
    async settle() {
      await reached;
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authz shadow mode", () => {
  describe("given the sample rate is zero", () => {
    it("does nothing at all", async () => {
      const reader = makeShadowReader();
      const shadow = makeShadow(reader, { sampleRate: 0 });

      shadow.userPermissionCheck({
        userId: "alice",
        permission: "traces:view",
        legacyAllowed: true,
        projectId: PROJECT,
        caller: "test",
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(reader.findProjectLineage).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("when legacy and engine disagree", () => {
    it("logs one structured mismatch and never throws", async () => {
      const shadow = makeShadow(makeShadowReader());

      // Engine will deny (no membership, no bindings); legacy said yes.
      shadow.userPermissionCheck({
        userId: "alice",
        permission: "traces:view",
        legacyAllowed: true,
        projectId: PROJECT,
        caller: "trpc.project",
      });

      await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          caller: "trpc.project",
          legacyAllowed: true,
          engineAllowed: false,
          permission: "traces:view",
          principalType: "user",
          knownDivergence: undefined,
        }),
        "authz shadow mismatch",
      );
    });
  });

  describe("when legacy and engine agree", () => {
    it("stays silent", async () => {
      const signal = readCompletionSignal();
      const shadow = makeShadow(
        makeShadowReader({
          findLegacyTeamMemberships: vi.fn(async () => {
            signal.markSeen();
            return [];
          }),
        }),
      );

      shadow.userPermissionCheck({
        userId: "alice",
        permission: "traces:view",
        legacyAllowed: false,
        projectId: PROJECT,
        caller: "trpc.project",
      });
      await signal.settle();

      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("when the comparison itself fails", () => {
    it("logs debug and swallows — never affects the response", async () => {
      const shadow = makeShadow(
        makeShadowReader({
          findProjectLineage: vi.fn().mockRejectedValue(new Error("db down")),
        }),
      );

      shadow.userPermissionCheck({
        userId: "alice",
        permission: "traces:view",
        legacyAllowed: true,
        projectId: PROJECT,
        caller: "trpc.project",
      });

      await vi.waitFor(() => expect(debug).toHaveBeenCalledTimes(1));
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("given an api-key check whose owner is a lite member", () => {
    /** The key's own binding allows; the EXTERNAL owner caps it. */
    const externalOwnerReader = () =>
      makeShadowReader({
        findApiKeyBindings: vi.fn().mockResolvedValue(projectBinding("ADMIN")),
        findOrganizationRole: vi.fn().mockResolvedValue("EXTERNAL"),
        findUserBindings: vi.fn().mockResolvedValue(projectBinding("MEMBER")),
      });

    it("tags the legacy-allowed, engine-denied direction as external-cap", async () => {
      const shadow = makeShadow(externalOwnerReader());

      shadow.apiKeyPermissionCheck({
        apiKeyId: "key-1",
        ownerUserId: "dave",
        organizationId: ORG,
        // Outside the lite-member bag, so the owner denies and the ceiling
        // bites - exactly the escalation legacy's api-key path allows.
        permission: "datasets:manage",
        legacyAllowed: true,
        projectId: PROJECT,
        caller: "apiKey.project",
      });

      await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          engineAllowed: false,
          legacyAllowed: true,
          knownDivergence: "external-cap",
          denialReason: "owner-ceiling",
        }),
        "authz shadow mismatch",
      );
    });

    it("leaves an engine over-allow untagged, EXTERNAL owner or not", async () => {
      const shadow = makeShadow(externalOwnerReader());

      shadow.apiKeyPermissionCheck({
        apiKeyId: "key-1",
        ownerUserId: "dave",
        organizationId: ORG,
        // Inside the lite-member bag: both key and owner allow, so the
        // engine says yes where legacy said no. Nothing to do with the
        // missing cap, so it must reach the dashboard as a real mismatch.
        permission: "traces:view",
        legacyAllowed: false,
        projectId: PROJECT,
        caller: "apiKey.project",
      });

      await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          engineAllowed: true,
          legacyAllowed: false,
          knownDivergence: undefined,
        }),
        "authz shadow mismatch",
      );
    });
  });

  describe("given an api-key check whose owner holds only legacy team rows", () => {
    it("tags the mismatch as ceiling-legacy-fallback", async () => {
      const shadow = makeShadow(
        makeShadowReader({
          findApiKeyBindings: vi
            .fn()
            .mockResolvedValue(projectBinding("ADMIN")),
          findOrganizationRole: vi.fn().mockResolvedValue("MEMBER"),
          // A chain binding exists, so the engine never reaches the legacy
          // fallback the old key ceiling would have used.
          findUserBindings: vi.fn().mockResolvedValue(projectBinding("VIEWER")),
          findLegacyTeamMemberships: vi.fn().mockResolvedValue([
            {
              teamId: TEAM,
              role: "ADMIN",
              customRoleId: null,
              isPersonal: false,
            },
          ]),
        }),
      );

      shadow.apiKeyPermissionCheck({
        apiKeyId: "key-1",
        ownerUserId: "dave",
        organizationId: ORG,
        permission: "datasets:manage",
        legacyAllowed: true,
        projectId: PROJECT,
        caller: "apiKey.project",
      });

      await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          knownDivergence: "ceiling-legacy-fallback",
        }),
        "authz shadow mismatch",
      );
    });
  });

  describe("given an api-key check with a plain mismatch", () => {
    it("files it untagged", async () => {
      const shadow = makeShadow(
        makeShadowReader({
          findOrganizationRole: vi.fn().mockResolvedValue("MEMBER"),
        }),
      );

      shadow.apiKeyPermissionCheck({
        apiKeyId: "key-1",
        ownerUserId: "dave",
        organizationId: ORG,
        permission: "traces:view",
        legacyAllowed: true,
        projectId: PROJECT,
        caller: "apiKey.project",
      });

      await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ knownDivergence: undefined }),
        "authz shadow mismatch",
      );
    });
  });

  describe("given a service key with no owner", () => {
    it("compares the key's own grants and collects no owner snapshot", async () => {
      const reader = makeShadowReader({
        findApiKeyBindings: vi.fn().mockResolvedValue(projectBinding("ADMIN")),
      });
      const shadow = makeShadow(reader);

      shadow.apiKeyPermissionCheck({
        apiKeyId: "key-1",
        ownerUserId: null,
        organizationId: ORG,
        permission: "datasets:manage",
        legacyAllowed: false,
        projectId: PROJECT,
        caller: "apiKey.project",
      });

      await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          engineAllowed: true,
          knownDivergence: undefined,
        }),
        "authz shadow mismatch",
      );
      expect(reader.findOrganizationRole).not.toHaveBeenCalled();
      expect(reader.findUserBindings).not.toHaveBeenCalled();
    });
  });

  describe("when the api-key path's scope does not resolve", () => {
    it("logs the unresolved outcome the user path logs", async () => {
      const shadow = makeShadow(
        makeShadowReader({
          findProjectLineage: vi.fn().mockResolvedValue(null),
        }),
      );

      shadow.apiKeyPermissionCheck({
        apiKeyId: "key-1",
        ownerUserId: "dave",
        organizationId: ORG,
        permission: "traces:view",
        legacyAllowed: true,
        projectId: "proj-ghost",
        caller: "apiKey.project",
      });

      await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          scopeType: "unresolved",
          engineAllowed: false,
          legacyAllowed: true,
          principalType: "apiKey",
        }),
        "authz shadow mismatch",
      );
    });
  });

  describe("when the legacy api-key resolver drives the user comparison", () => {
    it("classifies an EXTERNAL over-allow by the flag, not the caller label", async () => {
      const shadow = makeShadow(
        makeShadowReader({
          findOrganizationRole: vi.fn().mockResolvedValue("EXTERNAL"),
          findUserBindings: vi.fn().mockResolvedValue(projectBinding("MEMBER")),
        }),
      );

      shadow.userPermissionCheck({
        userId: "dave",
        permission: "datasets:manage",
        legacyAllowed: true,
        projectId: PROJECT,
        // A label the old startsWith("apiKey") test would have missed.
        caller: "rest.v2.traces",
        fromApiKeyPath: true,
      });

      await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ knownDivergence: "external-cap" }),
        "authz shadow mismatch",
      );
    });
  });
});
