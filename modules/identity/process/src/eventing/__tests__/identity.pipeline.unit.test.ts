/** Spec: specs/identity/sso-process-composition.feature */
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { UserApi } from "@langwatch/user-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { identityServer } from "../../identity.server.ts";
import { SsoBreakGlassService } from "../../services/sso-break-glass.service.ts";
import { SsoDomainReproofService } from "../../services/sso-domain-reproof.service.ts";
import {
  BREAK_GLASS_EXPIRY_WARN_INTERVAL_MS,
  BREAK_GLASS_EXPIRY_WARN_PROCESS_NAME,
} from "../break-glass-expiry-warn.process.ts";
import { IDENTITY_MAINTENANCE_PIPELINE_NAME, identityEventing } from "../identity.pipeline.ts";
import {
  SSO_DOMAIN_REPROOF_SWEEP_INTERVAL_MS,
  SSO_DOMAIN_REPROOF_SWEEP_PROCESS_NAME,
} from "../sso-domain-reproof-sweep.process.ts";

const HOUR_MS = 60 * 60 * 1000;

function intentContext(processName: string) {
  return {
    processName,
    projectId: "global",
    processKey: "global",
    tenantId: "global",
    messageKey: `${processName}:0`,
    attempt: 1,
  };
}

type Definition = Parameters<EventSourcing["register"]>[0];

/** The worker's own chain: createApp registers the module's declaration itself. */
async function installed() {
  const processStore = InMemoryProcessStore.createForTesting();
  const deleteDispatchedBefore = vi.spyOn(processStore, "deleteDispatchedBefore");
  const eventSourcing = EventSourcing.createForTesting({
    eventStore: EventStoreMemory.createForTesting(),
    processStore,
  });
  const registered: Definition[] = [];
  const register = eventSourcing.register.bind(eventSourcing);
  vi.spyOn(eventSourcing, "register").mockImplementation((definition) => {
    if (definition.metadata.name === IDENTITY_MAINTENANCE_PIPELINE_NAME) {
      registered.push(definition);
    }
    return register(definition);
  });
  const runtime = await createApp({ role: "worker" })
    .withModules([withMemoryRepositories(identityServer)])
    .withMembers({
      producesPipelines: false,
      adminEmails: [],
      publicBaseUrl: undefined,
      isSaas: false,
      rateLimiter: { check: async () => ({ allowed: true }) },
    })
    .withEncryption({ encrypt: (value) => value, decrypt: (value) => value })
    .withConfig({ identity: { ssoDomainProofDnsServers: [] } })
    .withRelational(createApiFixture<PrismaClient>())
    .withEventing(eventSourcing)
    .provide({
      organization: createApiFixture<OrganizationApi>(),
      authz: createApiFixture<AuthzApi>(),
      auth: createApiFixture<AuthApi>(),
      user: createApiFixture<UserApi>(),
      entitlement: createApiFixture<EntitlementApi>(),
      "audit-log": createApiFixture<AuditLogApi>(),
      licensing: createApiFixture<LicensingApi>(),
    })
    .boot();
  const definition = registered[0];
  if (!definition) throw new Error("the worker registered no identity maintenance pipeline");
  return { runtime, eventSourcing, definition, deleteDispatchedBefore };
}

function processOf(definition: Definition, processName: string) {
  const process = definition.processManagers.get(processName);
  if (!process) throw new Error(`the declaration built no "${processName}" process manager`);
  return process;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("given identity's eventing declaration", () => {
  describe("when the module is declared", () => {
    /** @scenario "The worker hosts identity's scheduled sweeps from the module" */
    it("carries the declaration onto the installable module", () => {
      expect(identityServer.eventing).toBe(identityEventing);
      expect(identityEventing.pipeline).toBe(IDENTITY_MAINTENANCE_PIPELINE_NAME);
    });
  });

  describe("when a consuming process builds it", () => {
    /** @scenario "The worker hosts identity's scheduled sweeps from the module" */
    it("schedules the domain re-proof every eight hours and the break-glass warning hourly", async () => {
      const { runtime, definition } = await installed();
      try {
        expect(definition.metadata.name).toBe(IDENTITY_MAINTENANCE_PIPELINE_NAME);
        expect(new Set(definition.processManagers.keys())).toEqual(
          new Set([BREAK_GLASS_EXPIRY_WARN_PROCESS_NAME, SSO_DOMAIN_REPROOF_SWEEP_PROCESS_NAME]),
        );
        expect(SSO_DOMAIN_REPROOF_SWEEP_INTERVAL_MS).toBe(8 * HOUR_MS);
        expect(BREAK_GLASS_EXPIRY_WARN_INTERVAL_MS).toBe(HOUR_MS);
      } finally {
        await runtime.stop();
      }
    });

    /** @scenario "Every proved domain is re-read three times a day by the worker" */
    it("re-reads proved domains through the installed app when the schedule fires", async () => {
      const sweep = vi.spyOn(SsoDomainReproofService.prototype, "sweep");
      const { runtime, definition, deleteDispatchedBefore } = await installed();
      try {
        const process = processOf(definition, SSO_DOMAIN_REPROOF_SWEEP_PROCESS_NAME);
        await process.config.intents!.sweep!.run(
          { scheduledFor: 0 },
          intentContext(SSO_DOMAIN_REPROOF_SWEEP_PROCESS_NAME),
        );

        expect(sweep).toHaveBeenCalledTimes(1);
        expect(deleteDispatchedBefore.mock.calls[0]![0]).toMatchObject({
          processName: SSO_DOMAIN_REPROOF_SWEEP_PROCESS_NAME,
        });
      } finally {
        await runtime.stop();
      }
    });

    /** @scenario "An ending way back in is warned about by the worker, not by a request" */
    it("sends the break-glass expiry warnings through the installed app", async () => {
      const sweepWarnings = vi.spyOn(SsoBreakGlassService.prototype, "sweepWarnings");
      const { runtime, definition, deleteDispatchedBefore } = await installed();
      try {
        const process = processOf(definition, BREAK_GLASS_EXPIRY_WARN_PROCESS_NAME);
        await process.config.intents!.warn!.run(
          { scheduledFor: 0 },
          intentContext(BREAK_GLASS_EXPIRY_WARN_PROCESS_NAME),
        );

        expect(sweepWarnings).toHaveBeenCalledTimes(1);
        await expect(sweepWarnings.mock.results[0]!.value).resolves.toEqual({ warned: 0 });
        expect(deleteDispatchedBefore.mock.calls[0]![0]).toMatchObject({
          processName: BREAK_GLASS_EXPIRY_WARN_PROCESS_NAME,
        });
      } finally {
        await runtime.stop();
      }
    });

    /** @scenario "The worker hosts identity's scheduled sweeps from the module" */
    it("is registered by the worker's own chain under its own pipeline name", async () => {
      const { runtime, eventSourcing } = await installed();
      try {
        expect(eventSourcing.getPipeline(IDENTITY_MAINTENANCE_PIPELINE_NAME)).toBeDefined();
      } finally {
        await runtime.stop();
      }
    });
  });
});
