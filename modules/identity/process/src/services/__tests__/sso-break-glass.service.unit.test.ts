/**
 * The way back in, and its expiry (D05, ADR-117 §5).
 * @see specs/identity/sso-connection-lifecycle.feature
 */
import {
  BREAK_GLASS_MAX_WINDOW_MS,
  SsoBreakGlassExpiryOutOfRangeError,
  SsoBreakGlassHolderIneligibleError,
  SsoBreakGlassLastWayInError,
  type BreakGlassBinding,
  type SsoConnectionState,
} from "@langwatch/identity-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SsoBreakGlassWarningChannel } from "../../channels/sso-break-glass-warning.channel.ts";
import { MemoryIdentityStore } from "../../repositories/memory/memory.identity.store.ts";
import { MemorySsoBreakGlassRepository } from "../../repositories/memory/memory.sso-break-glass.repository.ts";
import { breakGlassHolderEligibility } from "../../rules/break-glass-eligibility.rules.ts";
import { SsoBreakGlassService } from "../sso-break-glass.service.ts";

const NOW = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ORGANIZATION = "org_acme";

class RecordingWarnings extends SsoBreakGlassWarningChannel {
  readonly sent: { bindingId: string; daysRemaining: number }[] = [];

  async warn({
    binding,
    daysRemaining,
  }: {
    binding: BreakGlassBinding;
    daysRemaining: number;
  }): Promise<void> {
    this.sent.push({ bindingId: binding.bindingId, daysRemaining });
  }
}

let store: MemoryIdentityStore;
let warnings: RecordingWarnings;
let minted = 0;

function serviceFor({ eligible = true }: { eligible?: boolean } = {}) {
  return SsoBreakGlassService.create({
    bindings: MemorySsoBreakGlassRepository.create(store),
    warnings,
    newBindingId: () => `bgb_${(minted += 1)}`,
    directory: {
      findAdministrators: async () => [{ userId: "user_ada", name: "Ada", email: "ada@acme.com" }],
    },
    holderIsEligible: async () => eligible,
    now: () => NOW,
  });
}

function activeConnection(): void {
  store.ssoConnections.set("ssoc_1", {
    connectionId: "ssoc_1",
    organizationId: ORGANIZATION,
    type: "oidc",
    state: "ACTIVE",
    claimedDomains: [],
    domainClaims: [],
    approvedDomains: [],
    verifiedDomains: ["acme.com"],
    domainVerifications: [],
    pendingVerification: null,
    idpMetadata: {
      issuer: "https://acme.okta.com",
      providerId: "okta",
      clientIdRef: "cred_client",
      secretRef: "cred_secret",
      certRefs: [],
    },
    arrivalPolicy: "refuse",
    arrivalPolicyDecidedAtMs: null,
    source: "self-serve",
    testLoginAccountId: null,
    rejection: null,
    createdBy: null,
    createdAtMs: 1,
    updatedAtMs: 1,
    tearDownAfterMs: null,
    replacesConnectionId: null,
    migrationPhase: null,
    graceStartedAtMs: null,
    routeChangedAtMs: null,
    finalizationRequestedAtMs: null,
    finalizedAtMs: null,
  } satisfies SsoConnectionState);
}

const grant = (service: SsoBreakGlassService, expiresAtMs = NOW + 30 * DAY_MS) =>
  service.grant({
    organizationId: ORGANIZATION,
    userId: "user_ada",
    actor: { userId: "user_grace" },
    expiresAtMs,
  });

beforeEach(() => {
  store = MemoryIdentityStore.create();
  warnings = new RecordingWarnings();
  minted = 0;
});

describe("SsoBreakGlassService", () => {
  describe("when somebody is granted a way back in", () => {
    /** @scenario "A way back in is granted to a named person with an end date" */
    it("records the grantor apart from the holder, and answers the precondition", async () => {
      const service = serviceFor();

      const binding = await grant(service);

      expect(binding.grantedByUserId).toBe("user_grace");
      expect(binding.userId).toBe("user_ada");
      expect(binding.renewedFromBindingId).toBeNull();
      await expect(service.hasLiveBinding({ organizationId: ORGANIZATION })).resolves.toBe(true);
    });

    /** @scenario "A way back in is never open-ended" */
    it("refuses an expiry in the past or beyond the window, and writes nothing", async () => {
      const service = serviceFor();

      await expect(grant(service, NOW - DAY_MS)).rejects.toBeInstanceOf(
        SsoBreakGlassExpiryOutOfRangeError,
      );
      await expect(grant(service, NOW + BREAK_GLASS_MAX_WINDOW_MS + DAY_MS)).rejects.toBeInstanceOf(
        SsoBreakGlassExpiryOutOfRangeError,
      );
      expect(store.breakGlassBindings.size).toBe(0);
    });

    /** @scenario "A way back in names somebody who could actually use it" */
    it("refuses a holder who could not use the door being promised", async () => {
      await expect(grant(serviceFor({ eligible: false }))).rejects.toBeInstanceOf(
        SsoBreakGlassHolderIneligibleError,
      );
      expect(store.breakGlassBindings.size).toBe(0);
    });
  });

  describe("when a way back in is renewed", () => {
    /** @scenario "Renewing a way back in leaves the date it previously ended readable" */
    it("writes a new binding naming the old, and supersedes rather than edits it", async () => {
      const service = serviceFor();
      const first = await grant(service);

      const { renewed, replaced } = await service.renew({
        bindingId: first.bindingId,
        organizationId: ORGANIZATION,
        actor: { userId: "user_grace" },
        expiresAtMs: NOW + 60 * DAY_MS,
      });

      expect(renewed.renewedFromBindingId).toBe(first.bindingId);
      expect(renewed.userId).toBe(first.userId);
      expect(replaced.expiresAtMs).toBe(first.expiresAtMs);
      expect(store.breakGlassBindings.get(first.bindingId)?.supersededAtMs).toBe(NOW);
      await expect(service.live({ organizationId: ORGANIZATION })).resolves.toHaveLength(1);
      await expect(service.history({ organizationId: ORGANIZATION })).resolves.toHaveLength(2);
    });

    /** @scenario "A way back in is never open-ended" */
    it("refuses a renewal that would reach past the window", async () => {
      const service = serviceFor();
      const first = await grant(service);

      await expect(
        service.renew({
          bindingId: first.bindingId,
          organizationId: ORGANIZATION,
          actor: { userId: "user_grace" },
          expiresAtMs: NOW + BREAK_GLASS_MAX_WINDOW_MS + DAY_MS,
        }),
      ).rejects.toBeInstanceOf(SsoBreakGlassExpiryOutOfRangeError);
    });
  });

  describe("when a way back in is revoked", () => {
    /** @scenario "The last way back in cannot be revoked while a connection is live" */
    it("refuses the only live binding of an organization whose connection is ACTIVE", async () => {
      const service = serviceFor();
      const binding = await grant(service);
      activeConnection();

      await expect(
        service.revoke({ bindingId: binding.bindingId, organizationId: ORGANIZATION }),
      ).rejects.toBeInstanceOf(SsoBreakGlassLastWayInError);
      await expect(service.hasLiveBinding({ organizationId: ORGANIZATION })).resolves.toBe(true);
    });

    /** @scenario "The last way back in cannot be revoked while a connection is live" */
    it("allows it once somebody else holds one, and keeps the revoked row", async () => {
      const service = serviceFor();
      const first = await grant(service);
      await grant(service, NOW + 45 * DAY_MS);
      activeConnection();

      const revoked = await service.revoke({
        bindingId: first.bindingId,
        organizationId: ORGANIZATION,
      });

      expect(revoked.supersededAtMs).toBe(NOW);
      await expect(service.history({ organizationId: ORGANIZATION })).resolves.toHaveLength(2);
      await expect(service.live({ organizationId: ORGANIZATION })).resolves.toHaveLength(1);
    });
  });

  describe("when the expiry sweep runs", () => {
    /** @scenario "A way back in that is ending is warned about once per mark" */
    it("warns with the days actually left, and stays silent on a second pass", async () => {
      const service = serviceFor();
      await grant(service, NOW + 5 * DAY_MS);

      await expect(service.sweepWarnings()).resolves.toEqual({ warned: 1 });
      expect(warnings.sent).toEqual([{ bindingId: "bgb_1", daysRemaining: 5 }]);

      await expect(service.sweepWarnings()).resolves.toEqual({ warned: 0 });
      expect(warnings.sent).toHaveLength(1);
    });

    /** @scenario "A way back in that is ending is warned about once per mark" */
    it("says nothing about a binding that is still far out", async () => {
      const service = serviceFor();
      await grant(service, NOW + 60 * DAY_MS);

      await expect(service.sweepWarnings()).resolves.toEqual({ warned: 0 });
      expect(warnings.sent).toEqual([]);
    });
  });

  describe("when the organization's page reads its ways back in", () => {
    it("names who holds each grant and who gave it, with how long is left", async () => {
      const service = serviceFor();
      await grant(service);

      const [view] = await service.findGrants({ organizationId: ORGANIZATION });

      expect(view).toMatchObject({
        userId: "user_ada",
        name: "Ada",
        email: "ada@acme.com",
        grantedByUserId: "user_grace",
        live: true,
        daysRemaining: 30,
      });
    });

    it("leaves a grantor who is no longer an administrator unnamed rather than absent", async () => {
      const service = serviceFor();
      await grant(service);

      const [view] = await service.findGrants({ organizationId: ORGANIZATION });

      expect(view?.grantedByName).toBeNull();
    });

    it("offers the administrators as who one can be granted to", async () => {
      await expect(serviceFor().findCandidates({ organizationId: ORGANIZATION })).resolves.toEqual([
        { userId: "user_ada", name: "Ada", email: "ada@acme.com" },
      ]);
    });
  });

  describe("when eligibility is composed from standing and key", () => {
    /** @scenario "A way back in names somebody who could actually use it" */
    it("refuses an administrator who holds no password, and asks in that order", async () => {
      const holdsPassword = vi.fn(async () => false);
      const eligible = breakGlassHolderEligibility({
        isAdministrator: async ({ userId }) => userId === "user_ada",
        holdsPassword,
      });

      await expect(eligible({ organizationId: ORGANIZATION, userId: "user_ada" })).resolves.toBe(
        false,
      );
      await expect(eligible({ organizationId: ORGANIZATION, userId: "user_bob" })).resolves.toBe(
        false,
      );
      expect(holdsPassword).toHaveBeenCalledTimes(1);
    });
  });
});
