/**
 * @vitest-environment node
 * Spec: enterprise/modules/licensing/specs/licensing.feature
 */
import { Instance, Ksuid } from "@langwatch/ksuid";
import { describe, expect, it } from "vitest";

import { MemorySignInProviderMountRepository } from "../../repositories/memory/memory.sign-in-provider-mount.repository.ts";
import { SsoGateStatusService } from "../sso-gate-status.service.ts";

const NOW = 1_800_000_000;

function eventId({ second }: { second: number }): string {
  const instance = new Instance(Instance.schemes.RANDOM, new Uint8Array(8).fill(1));
  return new Ksuid({
    environment: "prod",
    resource: "event",
    timestamp: second,
    instance,
    sequenceId: 0,
  }).toString();
}

function gateStatus({ licensed = true }: { licensed?: boolean } = {}) {
  const mounts = MemorySignInProviderMountRepository.create();
  const service = SsoGateStatusService.create({
    mounts,
    isPlatformSsoLicensed: async () => licensed,
  });
  return { mounts, service };
}

describe("SsoGateStatusService", () => {
  describe("given sso recorded that its configured provider did not mount", () => {
    /** @scenario "The SSO gate status answers from sso's recorded sign-in provider" */
    it("answers that provider, not mounted, and whether a licence permits it", async () => {
      const { service } = gateStatus({ licensed: false });
      await service.applySignInProvider({
        provider: "okta",
        mounted: false,
        eventId: eventId({ second: NOW }),
      });

      await expect(service.getStatus()).resolves.toEqual({
        configuredProvider: "okta",
        licensed: false,
        mounted: false,
      });
    });
  });

  describe("given no sign-in provider fact applied yet", () => {
    /** @scenario "Before sso records a sign-in provider the gate status reports nothing to fix" */
    it("answers no configured provider, licensed and mounted", async () => {
      const { service } = gateStatus({ licensed: false });

      await expect(service.getStatus()).resolves.toEqual({
        configuredProvider: null,
        licensed: true,
        mounted: true,
      });
    });
  });

  describe("given a fact already applied", () => {
    /** @scenario "A redelivered or older sign-in provider fact never overwrites a newer one" */
    it("ignores the same event delivered again and an older one arriving late", async () => {
      const { mounts, service } = gateStatus();
      const applied = eventId({ second: NOW });
      await service.applySignInProvider({ provider: "okta", mounted: true, eventId: applied });

      await service.applySignInProvider({ provider: "okta", mounted: false, eventId: applied });
      await service.applySignInProvider({
        provider: "google",
        mounted: false,
        eventId: eventId({ second: NOW - 5 }),
      });

      await expect(mounts.find()).resolves.toEqual([
        { provider: "okta", mounted: true, lastAppliedEventId: applied },
      ]);
    });

    it("applies a newer fact and keeps its id as the row's version", async () => {
      const { mounts, service } = gateStatus();
      await service.applySignInProvider({
        provider: "okta",
        mounted: false,
        eventId: eventId({ second: NOW }),
      });
      const newer = eventId({ second: NOW + 1 });

      await service.applySignInProvider({ provider: "okta", mounted: true, eventId: newer });

      await expect(mounts.find()).resolves.toEqual([
        { provider: "okta", mounted: true, lastAppliedEventId: newer },
      ]);
    });
  });
});
