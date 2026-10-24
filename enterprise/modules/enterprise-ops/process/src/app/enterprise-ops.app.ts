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
import { SelfHostedNoticeAuditService } from "../services/self-hosted-notice-audit.service.ts";

type EnterpriseOpsSetup = FeatureSetup<typeof EnterpriseOpsModule.dependencies, undefined>;

/** Admits Cloud admin staff through ops, then forwards to licensing with the staff member recorded. */
export class EnterpriseOpsModule implements EnterpriseOpsApiContract {
  static readonly contract = EnterpriseOpsApi;
  static readonly dependencies = { ops: OpsApi, licensing: LicensingApi, auditLog: AuditLogApi };

  readonly #ops: Pick<OpsApi, "admitCloudAdmin" | "admitOperator">;
  readonly #licenses: LicenseRegistryAuditService;
  readonly #instances: SelfHostedInstanceAuditService;
  readonly #notices: SelfHostedNoticeAuditService;

  private constructor(deps: {
    ops: Pick<OpsApi, "admitCloudAdmin" | "admitOperator">;
    licenses: LicenseRegistryAuditService;
    instances: SelfHostedInstanceAuditService;
    notices: SelfHostedNoticeAuditService;
  }) {
    this.#ops = deps.ops;
    this.#licenses = deps.licenses;
    this.#instances = deps.instances;
    this.#notices = deps.notices;
  }

  static create({ dependencies }: EnterpriseOpsSetup): EnterpriseOpsModule {
    const { ops, licensing, auditLog } = dependencies;
    return new EnterpriseOpsModule({
      ops,
      licenses: LicenseRegistryAuditService.create({ registry: licensing, auditLog }),
      instances: SelfHostedInstanceAuditService.create({ instances: licensing, auditLog }),
      notices: SelfHostedNoticeAuditService.create({ notices: licensing, auditLog }),
    });
  }

  listIssuedLicenses: EnterpriseOpsApiContract["listIssuedLicenses"] = async ({
    operator,
    ...rest
  }) => this.#licenses.list({ ...rest, operatorId: await this.#staff(operator) });

  getIssuedLicense: EnterpriseOpsApiContract["getIssuedLicense"] = async ({ operator, id }) =>
    this.#licenses.getById({ id, operatorId: await this.#staff(operator) });

  issueLicense: EnterpriseOpsApiContract["issueLicense"] = async ({ operator, ...rest }) =>
    this.#licenses.issue({ ...rest, operatorId: await this.#manager(operator) });

  registerLegacyLicense: EnterpriseOpsApiContract["registerLegacyLicense"] = async ({
    operator,
    ...rest
  }) => this.#licenses.registerLegacy({ ...rest, operatorId: await this.#manager(operator) });

  revokeIssuedLicense: EnterpriseOpsApiContract["revokeIssuedLicense"] = async ({
    operator,
    ...rest
  }) => this.#licenses.revoke({ ...rest, operatorId: await this.#manager(operator) });

  reissueLicense: EnterpriseOpsApiContract["reissueLicense"] = async ({ operator, ...rest }) =>
    this.#licenses.reissue({ ...rest, operatorId: await this.#manager(operator) });

  changeLicenseSeats: EnterpriseOpsApiContract["changeLicenseSeats"] = async ({
    operator,
    ...rest
  }) => this.#licenses.changeSeats({ ...rest, operatorId: await this.#manager(operator) });

  resetLicenseInstanceBinding: EnterpriseOpsApiContract["resetLicenseInstanceBinding"] = async ({
    operator,
    id,
  }) => this.#licenses.resetInstanceBinding({ id, operatorId: await this.#manager(operator) });

  updateLicenseTerms: EnterpriseOpsApiContract["updateLicenseTerms"] = async ({
    operator,
    ...rest
  }) => this.#licenses.updateTerms({ ...rest, operatorId: await this.#manager(operator) });

  linkLicenseToOrganization: EnterpriseOpsApiContract["linkLicenseToOrganization"] = async ({
    operator,
    ...rest
  }) => this.#licenses.linkToOrganization({ ...rest, operatorId: await this.#manager(operator) });

  listActivationCodes: EnterpriseOpsApiContract["listActivationCodes"] = async ({
    operator,
    ...rest
  }) => this.#licenses.activationCodes({ ...rest, operatorId: await this.#staff(operator) });

  issueActivationCode: EnterpriseOpsApiContract["issueActivationCode"] = async ({
    operator,
    ...rest
  }) => this.#licenses.issueActivationCode({ ...rest, operatorId: await this.#manager(operator) });

  revokeActivationCode: EnterpriseOpsApiContract["revokeActivationCode"] = async ({
    operator,
    id,
  }) => this.#licenses.revokeActivationCode({ id, operatorId: await this.#manager(operator) });

  listSelfHostedInstances: EnterpriseOpsApiContract["listSelfHostedInstances"] = async ({
    operator,
    ...rest
  }) => this.#instances.list({ ...rest, operatorId: await this.#staff(operator) });

  getSelfHostedInstance: EnterpriseOpsApiContract["getSelfHostedInstance"] = async ({
    operator,
    id,
  }) => this.#instances.getById({ id, operatorId: await this.#staff(operator) });

  summarizeSelfHostedInstances: EnterpriseOpsApiContract["summarizeSelfHostedInstances"] = async ({
    operator,
  }) => this.#instances.summarize({ operatorId: await this.#staff(operator) });

  findUpgradeDiagnostics: EnterpriseOpsApiContract["findUpgradeDiagnostics"] = async ({
    operator,
    instanceRowId,
  }) => this.#instances.findDiagnostics({ instanceRowId, operatorId: await this.#staff(operator) });

  getUpgradeDiagnosticsDownload: EnterpriseOpsApiContract["getUpgradeDiagnosticsDownload"] =
    async ({ operator, id }) =>
      this.#instances.getDiagnosticsDownload({ id, operatorId: await this.#manager(operator) });

  findSelfHostedNotices: EnterpriseOpsApiContract["findSelfHostedNotices"] = async ({ operator }) =>
    this.#notices.findAll({ operatorId: await this.#staff(operator) });

  createSelfHostedNotice: EnterpriseOpsApiContract["createSelfHostedNotice"] = async ({
    operator,
    ...rest
  }) => this.#notices.create({ ...rest, operatorId: await this.#manager(operator) });

  updateSelfHostedNotice: EnterpriseOpsApiContract["updateSelfHostedNotice"] = async ({
    operator,
    ...rest
  }) => this.#notices.update({ ...rest, operatorId: await this.#manager(operator) });

  publishSelfHostedNotice: EnterpriseOpsApiContract["publishSelfHostedNotice"] = async ({
    operator,
    id,
  }) => this.#notices.publish({ id, operatorId: await this.#manager(operator) });

  withdrawSelfHostedNotice: EnterpriseOpsApiContract["withdrawSelfHostedNotice"] = async ({
    operator,
    id,
  }) => this.#notices.withdraw({ id, operatorId: await this.#manager(operator) });

  /** The staff member's id, or not-found; ops admits only where its cloud-ops capability is on (§3.5). */
  async #staff(operator: OpsOperator | null): Promise<string> {
    return (await this.#ops.admitCloudAdmin(operator)).id;
  }

  /** A registry write: staff as above who also hold `ops:manage`; `ops:view` only reads. */
  async #manager(operator: OpsOperator | null): Promise<string> {
    const id = await this.#staff(operator);
    await this.#ops.admitOperator(operator, "ops:manage");
    return id;
  }
}
