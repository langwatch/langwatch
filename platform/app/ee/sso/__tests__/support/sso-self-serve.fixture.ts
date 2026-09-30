// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  SsoConnectionCommand,
  SsoConnectionFactInput,
  SsoSelfServeContext,
} from "@langwatch/identity";
import { SsoConnectionService } from "../../sso-connection.service";
import type { LegacySsoOrganizationRepository } from "../../sso-connection-grandfather.service";
import { SsoConnectionGuards } from "../../sso-connection-guards";
import type { SsoConnectionLedger } from "../../sso-connection-ledger.port";
import type {
  SsoCredentialKind,
  SsoCredentialStore,
} from "../../sso-credential-store";
import {
  type SsoLegacyIdentityRetirementPort,
  type SsoMigrationFinalizationReadPort,
  SsoMigrationFinalizationService,
} from "../../sso-migration-finalization.service";
import {
  type SsoDomainFileFetch,
  type SsoDomainFileLookup,
  type SsoDomainProofLookup,
  type SsoDomainTxtLookup,
  type SsoMigrationProgressReadPort,
  type SsoSelfServeContextPort,
  SsoSelfServeService,
} from "../../sso-self-serve.service";
import {
  InMemoryConnections,
  StubBreakGlassBindings,
  StubLicenseAuthority,
  StubPlatformOperators,
  StubStranding,
} from "./in-memory-connections";
import {
  StubBreakGlassReads,
  StubMembers,
  StubTestSignIns,
} from "./in-memory-self-serve";

export class StubContext implements SsoSelfServeContextPort {
  constructor(private context: SsoSelfServeContext) {}

  async resolve(): Promise<SsoSelfServeContext> {
    return this.context;
  }

  set(context: SsoSelfServeContext): void {
    this.context = context;
  }
}

export class StubProofs implements SsoDomainProofLookup {
  published: string[] = [];
  unreachable: string | null = null;
  asked: { domain: string; name: string }[] = [];

  async lookupTxtValues(args: {
    domain: string;
    name: string;
  }): Promise<SsoDomainTxtLookup> {
    this.asked.push(args);
    if (this.unreachable !== null) {
      return { outcome: "unreachable", reason: this.unreachable };
    }
    if (this.published.length === 0) return { outcome: "absent" };
    return { outcome: "published", values: this.published };
  }
}

export class StubFiles implements SsoDomainFileLookup {
  served: string[] = [];
  unreachable: string | null = null;
  asked: { domain: string; url: string }[] = [];

  async fetchVerificationFile(args: {
    domain: string;
    url: string;
  }): Promise<SsoDomainFileFetch> {
    this.asked.push(args);
    if (this.unreachable !== null) {
      return { outcome: "unreachable", reason: this.unreachable };
    }
    if (this.served.length === 0) return { outcome: "absent" };
    return { outcome: "served", values: this.served };
  }
}

export class InMemoryCredentials implements SsoCredentialStore {
  private readonly held = new Map<
    string,
    { organizationId: string; value: string }
  >();

  async put({
    organizationId,
    kind,
    value,
  }: {
    organizationId: string;
    connectionId: string;
    kind: SsoCredentialKind;
    value: string;
  }): Promise<string> {
    const ref = `cred_${kind}_${this.held.size}`;
    this.held.set(ref, { organizationId, value });
    return ref;
  }

  async read({
    organizationId,
    ref,
  }: {
    organizationId: string;
    ref: string;
  }): Promise<string | null> {
    const record = this.held.get(ref);
    return record?.organizationId === organizationId ? record.value : null;
  }
}

interface SelfServeFixtureOptions {
  context: SsoSelfServeContext;
  now: () => number;
  licenseAuthorizesDomainClaims?: boolean;
  platformOperatorIds?: string[];
  legacy?: LegacySsoOrganizationRepository;
  members?: StubMembers;
  migrations?: SsoMigrationProgressReadPort;
  migrationEvidence?: SsoMigrationFinalizationReadPort;
  legacyRetirement?: SsoLegacyIdentityRetirementPort;
}

/** Real services and guards over the production reducer, with I/O held in memory. */
export function createSsoSelfServeFixture(options: SelfServeFixtureOptions) {
  const connections = new InMemoryConnections();
  const context = new StubContext(options.context);
  const proofs = new StubProofs();
  const files = new StubFiles();
  const activationBindings = new StubBreakGlassBindings(true);
  const licenseAuthority = new StubLicenseAuthority(
    options.licenseAuthorizesDomainClaims ?? false,
  );
  const testSignIns = new StubTestSignIns();
  const breakGlassReads = new StubBreakGlassReads();
  const members = options.members ?? new StubMembers();
  const committed: {
    command: SsoConnectionCommand;
    facts: SsoConnectionFactInput[];
  }[] = [];
  const seenCommandIds = new Set<string>();
  const ledger: SsoConnectionLedger = {
    async commit({ command, facts }) {
      // Concurrent or retried commands must not append or fold their facts twice.
      if (seenCommandIds.has(command.data.commandId)) return [];
      seenCommandIds.add(command.data.commandId);
      committed.push({ command, facts });
      connections.apply({
        connectionId: command.data.connectionId,
        facts,
        occurredAt: command.data.occurredAtMs,
      });
      return facts.map((fact) => ({
        ...fact,
        occurredAt: command.data.occurredAtMs,
      }));
    },
  };
  const connectionService = new SsoConnectionService(
    new SsoConnectionGuards({
      connections,
      registrationSlots: connections,
      breakGlass: activationBindings,
      stranding: new StubStranding(),
      platformOperators: new StubPlatformOperators(options.platformOperatorIds),
      licenseAuthority,
    }),
    ledger,
  );
  let finalizationCommand = 0;
  const finalization = new SsoMigrationFinalizationService({
    connections: () => connectionService,
    evidence: options.migrationEvidence ?? { inspect: async () => null },
    retirement: options.legacyRetirement ?? {
      retire: async () => {
        throw new Error(
          "Configure legacy retirement for this migration scenario",
        );
      },
    },
    now: options.now,
    newCommandId: () => `command_finalize_${finalizationCommand++}`,
  });
  const selfServe = new SsoSelfServeService({
    connections: () => connectionService,
    reads: connections,
    legacy: options.legacy ?? { findLegacySso: async () => null },
    context,
    proofs,
    files,
    credentials: new InMemoryCredentials(),
    discovery: { discover: async () => ({ reachable: true }) },
    baseUrl: "https://app.langwatch.test",
    testSignIns,
    breakGlass: breakGlassReads,
    members,
    migrations: options.migrations ?? { getProgress: async () => null },
    finalization,
    now: options.now,
  });

  return {
    selfServe,
    connectionService,
    connections,
    context,
    proofs,
    files,
    activationBindings,
    licenseAuthority,
    testSignIns,
    breakGlassReads,
    members,
    committed,
    ledger,
  };
}
