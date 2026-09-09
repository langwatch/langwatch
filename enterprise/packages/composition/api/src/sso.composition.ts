import { AuditLogApi } from "@langwatch/audit-log-contract";
import { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import {
  SsoApi,
  type SsoConfiguration,
  type SsoApi as SsoApiContract,
} from "@langwatch/enterprise-sso-contract";
import {
  ssoServer,
  type SsoConnectionLedgerPort,
  type SsoGateLoggerPort,
} from "@langwatch/enterprise-sso-server";
import { OpsApi } from "@langwatch/ops-contract";
import { createApp } from "@langwatch/runtime-composition";
import { UserApi } from "@langwatch/user-contract";

/** The other features' capabilities single sign-on is gated and recorded by. */
export type EnterpriseApiSsoPeers = Readonly<{
  /** Whether this deployment's licence permits federation. */
  licensing: LicensingApi;
  /** The ADMIN_EMAILS staff list the back office is gated on. */
  operators: OpsApi;
  /** Resolves the operator behind an actor id, so the staff list has an address. */
  users: UserApi;
  /** Where every back-office attempt is recorded, before the command runs. */
  auditLog: AuditLogApi;
}>;

/** Single sign-on, booted over this deployment's own ledger and licence. */
export class EnterpriseApiSso {
  private constructor(
    private readonly api: SsoApiContract,
    private readonly close: () => Promise<void>,
  ) {}

  static async create(options: {
    configuration: SsoConfiguration;
    connections: SsoConnectionLedgerPort;
    logger: SsoGateLoggerPort;
    peers: EnterpriseApiSsoPeers;
  }): Promise<EnterpriseApiSso> {
    const runtime = await createApp({ name: "enterprise-api:sso" })
      .withPersistence("memory", {})
      .withInfrastructure({})
      .withProvided(LicensingApi, options.peers.licensing)
      .withProvided(OpsApi, options.peers.operators)
      .withProvided(UserApi, options.peers.users)
      .withProvided(AuditLogApi, options.peers.auditLog)
      .withModule(ssoServer, {
        infrastructure: { connections: options.connections, logger: options.logger },
      })
      .boot({ role: "api", config: { sso: options.configuration } });

    return new EnterpriseApiSso(runtime.service(SsoApi), () => runtime.stop());
  }

  sso(): SsoApiContract {
    return this.api;
  }

  stop(): Promise<void> {
    return this.close();
  }
}
