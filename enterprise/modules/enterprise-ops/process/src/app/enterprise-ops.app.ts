// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import {
  EnterpriseOpsApi,
  type EnterpriseOpsApi as EnterpriseOpsApiContract,
} from "@langwatch/enterprise-ops-contract";
import { OpsApi, type OpsOperator } from "@langwatch/ops-contract";
import type { FeatureSetup } from "@langwatch/process";

import { LicenseRegistryAuditService } from "../services/license-registry-audit.service.ts";
import { SelfHostedInstanceAuditService } from "../services/self-hosted-instance-audit.service.ts";

type EnterpriseOpsSetup = FeatureSetup<typeof EnterpriseOpsApp.dependencies, never, undefined>;

/** Admits Cloud admin staff through ops, then forwards to licensing with the staff member recorded. */
export class EnterpriseOpsApp implements EnterpriseOpsApiContract {
  static readonly contract = EnterpriseOpsApi;
  static readonly dependencies = { ops: OpsApi, licensing: LicensingApi, auditLog: AuditLogApi };

  readonly #ops: Pick<OpsApi, "admitCloudAdmin">;
  readonly #licenses: LicenseRegistryAuditService;
  readonly #instances: SelfHostedInstanceAuditService;

  private constructor(deps: {
    ops: Pick<OpsApi, "admitCloudAdmin">;
    licenses: LicenseRegistryAuditService;
    instances: SelfHostedInstanceAuditService;
  }) {
    this.#ops = deps.ops;
    this.#licenses = deps.licenses;
    this.#instances = deps.instances;
  }

  static create({ dependencies }: EnterpriseOpsSetup): EnterpriseOpsApp {
    const { ops, licensing, auditLog } = dependencies;
    return new EnterpriseOpsApp({
      ops,
      licenses: LicenseRegistryAuditService.create({ registry: licensing, auditLog }),
      instances: SelfHostedInstanceAuditService.create({ instances: licensing, auditLog }),
    });
  }

  listIssuedLicenses: EnterpriseOpsApiContract["listIssuedLicenses"] = async ({
    operator,
    ...rest
  }) => this.#licenses.list({ ...rest, operatorId: await this.#staff(operator) });

  getIssuedLicense: EnterpriseOpsApiContract["getIssuedLicense"] = async ({ operator, id }) =>
    this.#licenses.getById({ id, operatorId: await this.#staff(operator) });

  issueLicense: EnterpriseOpsApiContract["issueLicense"] = async ({ operator, ...rest }) =>
    this.#licenses.issue({ ...rest, operatorId: await this.#staff(operator) });

  registerLegacyLicense: EnterpriseOpsApiContract["registerLegacyLicense"] = async ({
    operator,
    ...rest
  }) => this.#licenses.registerLegacy({ ...rest, operatorId: await this.#staff(operator) });

  revokeIssuedLicense: EnterpriseOpsApiContract["revokeIssuedLicense"] = async ({
    operator,
    ...rest
  }) => this.#licenses.revoke({ ...rest, operatorId: await this.#staff(operator) });

  reissueLicense: EnterpriseOpsApiContract["reissueLicense"] = async ({ operator, ...rest }) =>
    this.#licenses.reissue({ ...rest, operatorId: await this.#staff(operator) });

  changeLicenseSeats: EnterpriseOpsApiContract["changeLicenseSeats"] = async ({
    operator,
    ...rest
  }) => this.#licenses.changeSeats({ ...rest, operatorId: await this.#staff(operator) });

  resetLicenseInstanceBinding: EnterpriseOpsApiContract["resetLicenseInstanceBinding"] = async ({
    operator,
    id,
  }) => this.#licenses.resetInstanceBinding({ id, operatorId: await this.#staff(operator) });

  updateLicenseTerms: EnterpriseOpsApiContract["updateLicenseTerms"] = async ({
    operator,
    ...rest
  }) => this.#licenses.updateTerms({ ...rest, operatorId: await this.#staff(operator) });

  linkLicenseToOrganization: EnterpriseOpsApiContract["linkLicenseToOrganization"] = async ({
    operator,
    ...rest
  }) => this.#licenses.linkToOrganization({ ...rest, operatorId: await this.#staff(operator) });

  listActivationCodes: EnterpriseOpsApiContract["listActivationCodes"] = async ({
    operator,
    ...rest
  }) => this.#licenses.activationCodes({ ...rest, operatorId: await this.#staff(operator) });

  issueActivationCode: EnterpriseOpsApiContract["issueActivationCode"] = async ({
    operator,
    ...rest
  }) => this.#licenses.issueActivationCode({ ...rest, operatorId: await this.#staff(operator) });

  revokeActivationCode: EnterpriseOpsApiContract["revokeActivationCode"] = async ({
    operator,
    id,
  }) => this.#licenses.revokeActivationCode({ id, operatorId: await this.#staff(operator) });

  listSelfHostedInstances: EnterpriseOpsApiContract["listSelfHostedInstances"] = async ({
    operator,
    ...rest
  }) => this.#instances.list({ ...rest, operatorId: await this.#staff(operator) });

  getSelfHostedInstance: EnterpriseOpsApiContract["getSelfHostedInstance"] = async ({
    operator,
    id,
  }) => this.#instances.getById({ id, operatorId: await this.#staff(operator) });

  /** The staff member's id, or not-found; ops admits only where its cloud-ops capability is on (§3.5). */
  async #staff(operator: OpsOperator | null): Promise<string> {
    return (await this.#ops.admitCloudAdmin(operator)).id;
  }
}
