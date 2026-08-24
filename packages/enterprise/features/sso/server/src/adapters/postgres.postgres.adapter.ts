import type { SsoConfiguration } from "@langwatch/enterprise-sso-contract";
import type { SsoDatabase } from "../ports/sso-database.port";
import { PrismaSsoLicenseRepository } from "../repositories/prisma/prisma.sso-license.repository";
import {
  type SsoGateLogger,
  SsoGateService,
  type SsoLicenseVerifier,
  type SsoProviderMountInspector,
} from "../services/sso-gate.service";

export interface PostgresSsoAdapterOptions {
  database: SsoDatabase;
  configuration: SsoConfiguration;
  verifier: SsoLicenseVerifier;
  logger: SsoGateLogger;
  providerMountInspector: SsoProviderMountInspector;
  evaluationTimeoutMs?: number | undefined;
}

export class PostgresSsoAdapter {
  private constructor(private readonly options: PostgresSsoAdapterOptions) {}

  static create(options: PostgresSsoAdapterOptions): PostgresSsoAdapter {
    return new PostgresSsoAdapter(options);
  }

  build(): SsoGateService {
    return SsoGateService.create({
      configuration: this.options.configuration,
      repository: PrismaSsoLicenseRepository.create(this.options.database),
      verifier: this.options.verifier,
      logger: this.options.logger,
      providerMountInspector: this.options.providerMountInspector,
      evaluationTimeoutMs: this.options.evaluationTimeoutMs,
    });
  }
}
