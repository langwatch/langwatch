import type { LicensingService } from "@langwatch/enterprise-licensing-contract";
import type { SsoConfiguration } from "@langwatch/enterprise-sso-contract";
import {
  type SsoGateLogger,
  SsoGateService,
  type SsoProviderMountInspector,
} from "../services/sso-gate.service";

export interface LicensingSsoAdapterOptions {
  configuration: SsoConfiguration;
  licensing: LicensingService;
  logger: SsoGateLogger;
  providerMountInspector: SsoProviderMountInspector;
  evaluationTimeoutMs?: number | undefined;
}

export class LicensingSsoAdapter {
  private constructor(private readonly options: LicensingSsoAdapterOptions) {}

  static create(options: LicensingSsoAdapterOptions): LicensingSsoAdapter {
    return new LicensingSsoAdapter(options);
  }

  build(): SsoGateService {
    return SsoGateService.create({
      configuration: this.options.configuration,
      licensing: this.options.licensing,
      logger: this.options.logger,
      providerMountInspector: this.options.providerMountInspector,
      evaluationTimeoutMs: this.options.evaluationTimeoutMs,
    });
  }
}
