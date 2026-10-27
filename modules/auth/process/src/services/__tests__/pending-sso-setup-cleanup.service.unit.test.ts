/**
 * @vitest-environment node
 * Main's one-off cleanup of a stale `pendingSsoSetup` flag, over the memory
 * twin of the flagged rows. Spec: specs/auth/sso-wrong-provider-recovery.feature.
 */
import type { OrganizationSsoProviderLookup } from "@langwatch/auth-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryPendingSsoSetupRepository } from "../../repositories/memory/memory.pending-sso-setup.repository.ts";
import type { PendingSsoSetupCandidate } from "../../repositories/pending-sso-setup.repository.ts";
import { PendingSsoSetupCleanupService } from "../pending-sso-setup-cleanup.service.ts";

function candidate(over: Partial<PendingSsoSetupCandidate> = {}): PendingSsoSetupCandidate {
  return { id: "user-1", email: "member@acme.com", accounts: [], ...over };
}

const google = (accountId: string) => [{ providerId: "google", accountId }];

function organizationsPinning({ ssoProvider }: { ssoProvider: string | null }) {
  const calls: string[] = [];
  const organizations: OrganizationSsoProviderLookup = {
    async findByDomain({ domain }) {
      calls.push(domain);
      return { id: "org-1", name: "Acme", ssoProvider };
    },
  };
  return { organizations, calls };
}

function cleanupOver({
  candidates,
  ssoProvider = "google",
}: {
  candidates: PendingSsoSetupCandidate[];
  ssoProvider?: string | null;
}) {
  const repository = MemoryPendingSsoSetupRepository.create({ candidates });
  const { organizations, calls } = organizationsPinning({ ssoProvider });
  const service = PendingSsoSetupCleanupService.create({ candidates: repository, organizations });
  const stillFlagged = () => [...repository.pending.keys()];
  return { service, repository, calls, stillFlagged };
}

describe("clearing stale pending single sign-on setup flags", () => {
  describe("given a flagged user holding a matching account", () => {
    /** @scenario "A one-off cleanup clears the reminder for members who already sign in the right way" */
    it("clears the flag and counts it as cleared", async () => {
      const { service, stillFlagged } = cleanupOver({
        candidates: [candidate({ accounts: google("sub-123") })],
      });

      const result = await service.clearStale({ isDryRun: false });

      expect(stillFlagged()).toEqual([]);
      expect(result).toEqual({
        scanned: 1,
        cleared: 1,
        stillPending: 0,
        skipped: 0,
        failed: 0,
        isDryRun: false,
      });
    });
  });

  describe("given a flagged user with no matching account", () => {
    /** @scenario "The cleanup leaves the reminder for members who have not yet signed in the right way" */
    it("leaves the flag untouched and counts it as still pending", async () => {
      const { service, stillFlagged } = cleanupOver({
        candidates: [candidate({ accounts: [{ providerId: "credential", accountId: "user-1" }] })],
      });

      const result = await service.clearStale({ isDryRun: false });

      expect(stillFlagged()).toEqual(["user-1"]);
      expect(result).toEqual({
        scanned: 1,
        cleared: 0,
        stillPending: 1,
        skipped: 0,
        failed: 0,
        isDryRun: false,
      });
    });
  });

  describe("given a flagged user whose organization no longer pins a provider", () => {
    it("clears the flag, since there is nothing left to satisfy", async () => {
      const { service, stillFlagged } = cleanupOver({
        candidates: [candidate()],
        ssoProvider: null,
      });

      const result = await service.clearStale({ isDryRun: false });

      expect(stillFlagged()).toEqual([]);
      expect(result).toMatchObject({ scanned: 1, cleared: 1 });
    });
  });

  describe("given a flagged user with no email", () => {
    it("skips the user without looking an organization up", async () => {
      const { service, calls, stillFlagged } = cleanupOver({
        candidates: [candidate({ email: null })],
      });

      const result = await service.clearStale({ isDryRun: false });

      expect(stillFlagged()).toEqual(["user-1"]);
      expect(calls).toHaveLength(0);
      expect(result).toMatchObject({ scanned: 1, skipped: 1, cleared: 0 });
    });
  });

  describe("when running in dry-run mode", () => {
    it("writes nothing but reports the same counts as a live run", async () => {
      const { service, stillFlagged } = cleanupOver({
        candidates: [
          candidate({ id: "user-1", accounts: google("sub-1") }),
          candidate({ id: "user-2" }),
        ],
      });

      const result = await service.clearStale({ isDryRun: true });

      expect(stillFlagged()).toEqual(["user-1", "user-2"]);
      expect(result).toEqual({
        scanned: 2,
        cleared: 1,
        stillPending: 1,
        skipped: 0,
        failed: 0,
        isDryRun: true,
      });
    });
  });

  describe("given more flagged users than one page holds", () => {
    it("pages through every one of them", async () => {
      const { service, stillFlagged } = cleanupOver({
        candidates: ["user-1", "user-2", "user-3"].map((id) =>
          candidate({ id, accounts: google(`sub-${id}`) }),
        ),
      });

      const result = await service.clearStale({ isDryRun: false, batchSize: 2 });

      expect(stillFlagged()).toEqual([]);
      expect(result).toMatchObject({ scanned: 3, cleared: 3 });
    });
  });

  describe("given several flagged users sharing the same email domain", () => {
    it("looks the organization up once for the whole run", async () => {
      const { service, calls } = cleanupOver({
        candidates: [
          candidate({ id: "user-1", accounts: google("sub-1") }),
          candidate({ id: "user-2", accounts: google("sub-2") }),
          candidate({ id: "user-3" }),
        ],
      });

      await service.clearStale({ isDryRun: false });

      expect(calls).toEqual(["acme.com"]);
    });
  });

  describe("given one user fails to process", () => {
    it("counts the failure and still processes the remaining users", async () => {
      const { service, repository, stillFlagged } = cleanupOver({
        candidates: [
          candidate({ id: "user-1", accounts: google("sub-1") }),
          candidate({ id: "user-2", accounts: google("sub-2") }),
        ],
      });
      vi.spyOn(repository, "clearPendingSsoSetup").mockRejectedValueOnce(
        new Error("write conflict"),
      );

      const result = await service.clearStale({ isDryRun: false });

      expect(stillFlagged()).toEqual(["user-1"]);
      expect(result).toEqual({
        scanned: 2,
        cleared: 1,
        stillPending: 0,
        skipped: 0,
        failed: 1,
        isDryRun: false,
      });
    });
  });

  describe("given everyone was cleared by a previous run", () => {
    it("finds nothing to do on a second run", async () => {
      const { service } = cleanupOver({ candidates: [candidate({ accounts: google("sub-1") })] });
      await service.clearStale({ isDryRun: false });

      const second = await service.clearStale({ isDryRun: false });

      expect(second).toEqual({
        scanned: 0,
        cleared: 0,
        stillPending: 0,
        skipped: 0,
        failed: 0,
        isDryRun: false,
      });
    });
  });
});
