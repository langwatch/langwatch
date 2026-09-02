// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  actorIdForRollupWrite,
  resetErasureSecretCache,
} from "../logic/erasedActorId";
import { ERASURE_SECRET_ENV, erasureDigest } from "../logic/erasureDigest";
import {
  clearSuppressionSnapshot,
  installSuppressionSnapshot,
  SuppressionSnapshot,
  type SuppressionSnapshotData,
} from "../logic/suppressionSnapshot";

const SECRET = "a".repeat(32);
const TENANT = "project_gov_new";
const ERASED = "leaver@acme.test";
const ACTIVE = "stays@acme.test";

function snapshotHolding(
  entries: { organizationId: string; digests: string[] }[],
  tenants: { tenantId: string; organizationId: string }[],
): SuppressionSnapshotData {
  return {
    digestsByOrganization: new Map(
      entries.map((entry) => [entry.organizationId, new Set(entry.digests)]),
    ),
    organizationByTenant: new Map(
      tenants.map((tenant) => [tenant.tenantId, tenant.organizationId]),
    ),
  };
}

/** Installs a snapshot and waits for its first load, so lookups are decided. */
async function install(data: SuppressionSnapshotData): Promise<void> {
  const snapshot = new SuppressionSnapshot(async () => data);
  await snapshot.refreshNow();
  installSuppressionSnapshot(snapshot);
}

describe("given the actor id a money row is about to be written under", () => {
  beforeEach(() => {
    vi.stubEnv(ERASURE_SECRET_ENV, SECRET);
    resetErasureSecretCache();
    clearSuppressionSnapshot();
  });

  afterEach(() => {
    clearSuppressionSnapshot();
    resetErasureSecretCache();
  });

  describe("when nobody in the organization has been erased", () => {
    /** @scenario "A day nobody was erased on costs nothing to check" */
    it("stores the identifier exactly as the provider sent it", async () => {
      await install(
        snapshotHolding([], [{ tenantId: TENANT, organizationId: "org_a" }]),
      );

      expect(
        actorIdForRollupWrite({ tenantId: TENANT, rawActorId: ACTIVE }),
      ).toBe(ACTIVE);
    });
  });

  describe("when no process has installed a view of the erasure list", () => {
    it("behaves exactly as it did before erasure existed", () => {
      expect(
        actorIdForRollupWrite({ tenantId: TENANT, rawActorId: ACTIVE }),
      ).toBe(ACTIVE);
    });
  });

  describe("when the identifier belongs to somebody erased", () => {
    it("writes the stand-in instead", async () => {
      const digest = erasureDigest({ secret: SECRET, identifier: ERASED });
      await install(
        snapshotHolding(
          [{ organizationId: "org_a", digests: [digest] }],
          [{ tenantId: TENANT, organizationId: "org_a" }],
        ),
      );

      expect(
        actorIdForRollupWrite({ tenantId: TENANT, rawActorId: ERASED }),
      ).toBe(digest);
    });

    /** @scenario "Rebuilding twice lands on the same stand-in" */
    it("writes the same stand-in every time, so a rebuild never mints a new key", async () => {
      const digest = erasureDigest({ secret: SECRET, identifier: ERASED });
      await install(
        snapshotHolding(
          [{ organizationId: "org_a", digests: [digest] }],
          [{ tenantId: TENANT, organizationId: "org_a" }],
        ),
      );

      const first = actorIdForRollupWrite({
        tenantId: TENANT,
        rawActorId: ERASED,
      });
      const second = actorIdForRollupWrite({
        tenantId: TENANT,
        rawActorId: ERASED,
      });

      expect(first).toBe(second);
      expect(first).toBe(digest);
    });
  });

  describe("when somebody else in the organization was erased", () => {
    it("leaves this identifier alone", async () => {
      await install(
        snapshotHolding(
          [
            {
              organizationId: "org_a",
              digests: [erasureDigest({ secret: SECRET, identifier: ERASED })],
            },
          ],
          [{ tenantId: TENANT, organizationId: "org_a" }],
        ),
      );

      expect(
        actorIdForRollupWrite({ tenantId: TENANT, rawActorId: ACTIVE }),
      ).toBe(ACTIVE);
    });
  });

  describe("when the erasure happened in a different organization", () => {
    it("leaves this organization's identical identifier alone", async () => {
      await install(
        snapshotHolding(
          [
            {
              organizationId: "org_b",
              digests: [erasureDigest({ secret: SECRET, identifier: ERASED })],
            },
          ],
          [{ tenantId: TENANT, organizationId: "org_a" }],
        ),
      );

      expect(
        actorIdForRollupWrite({ tenantId: TENANT, rawActorId: ERASED }),
      ).toBe(ERASED);
    });
  });

  describe("when the row carries no actor at all", () => {
    it("leaves the empty value alone rather than hashing it", async () => {
      await install(
        snapshotHolding(
          [
            {
              organizationId: "org_a",
              digests: [erasureDigest({ secret: SECRET, identifier: "" })],
            },
          ],
          [{ tenantId: TENANT, organizationId: "org_a" }],
        ),
      );

      expect(actorIdForRollupWrite({ tenantId: TENANT, rawActorId: "" })).toBe(
        "",
      );
    });
  });

  describe("when the tenant is one nothing has recorded", () => {
    it("answers with the identifier rather than guessing an organization", async () => {
      await install(
        snapshotHolding(
          [
            {
              organizationId: "org_a",
              digests: [erasureDigest({ secret: SECRET, identifier: ERASED })],
            },
          ],
          [],
        ),
      );

      expect(
        actorIdForRollupWrite({
          tenantId: "project_unknown",
          rawActorId: ERASED,
        }),
      ).toBe(ERASED);
    });
  });
});

describe("given the snapshot the fold reads the erasure list through", () => {
  afterEach(() => clearSuppressionSnapshot());

  describe("when a lookup arrives before anything has been loaded", () => {
    it("answers without waiting, and loads for the next caller", async () => {
      let loads = 0;
      const snapshot = new SuppressionSnapshot(async () => {
        loads += 1;
        return snapshotHolding(
          [{ organizationId: "org_a", digests: ["deadbeef"] }],
          [{ tenantId: TENANT, organizationId: "org_a" }],
        );
      });

      expect(snapshot.hasAnySuppressionForTenant(TENANT)).toBe(false);
      await vi.waitFor(() => expect(loads).toBe(1));
      expect(snapshot.hasAnySuppressionForTenant(TENANT)).toBe(true);
    });
  });

  describe("when the list cannot be read", () => {
    it("keeps answering rather than failing the fold", async () => {
      const snapshot = new SuppressionSnapshot(async () => {
        throw new Error("connection refused");
      });

      await snapshot.refreshNow();

      expect(snapshot.hasAnySuppressionForTenant(TENANT)).toBe(false);
      expect(
        snapshot.isSuppressedForTenant({
          tenantId: TENANT,
          identifierHash: "deadbeef",
        }),
      ).toBe(false);
    });
  });

  describe("when many lookups arrive while a load is in flight", () => {
    it("issues one load rather than one per lookup", async () => {
      let loads = 0;
      const snapshot = new SuppressionSnapshot(async () => {
        loads += 1;
        return snapshotHolding([], []);
      });

      for (let i = 0; i < 50; i += 1) {
        snapshot.hasAnySuppressionForTenant(TENANT);
      }
      await vi.waitFor(() => expect(loads).toBe(1));

      expect(loads).toBe(1);
    });
  });

  describe("when the snapshot is older than its lifetime", () => {
    it("reloads on the next lookup", async () => {
      let loads = 0;
      let clock = 0;
      const snapshot = new SuppressionSnapshot(
        async () => {
          loads += 1;
          return snapshotHolding([], []);
        },
        () => clock,
        1_000,
      );

      await snapshot.refreshNow();
      expect(loads).toBe(1);

      snapshot.hasAnySuppressionForTenant(TENANT);
      expect(loads).toBe(1);

      clock = 5_000;
      snapshot.hasAnySuppressionForTenant(TENANT);
      await vi.waitFor(() => expect(loads).toBe(2));
    });
  });
});
