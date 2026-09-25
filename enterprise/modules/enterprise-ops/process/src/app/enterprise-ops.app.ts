// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import {
  EnterpriseOpsApi,
  type EnterpriseOpsApi as EnterpriseOpsApiContract,
} from "@langwatch/enterprise-ops-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import { OpsApi, type OpsOperator } from "@langwatch/ops-contract";

import { LicenseRegistryAuditService } from "../services/license-registry-audit.service.ts";
import { SelfHostedInstanceAuditService } from "../services/self-hosted-instance-audit.service.ts";

type EnterpriseOpsSetup = FeatureSetup<typeof EnterpriseOpsApp.dependencies, never, undefined>;

/** Admits back-office staff through ops, then forwards to licensing with the staff member recorded. */
export class EnterpriseOpsApp implements EnterpriseOpsApiContract {
  static readonly contract = EnterpriseOpsApi;
  static readonly dependencies = { ops: OpsApi, licensing: LicensingApi, auditLog: AuditLogApi };

  readonly #ops: Pick<OpsApi, "admitBackOfficeStaff">;
  readonly #licenses: LicenseRegistryAuditService;
  readonly #instances: SelfHostedInstanceAuditService;

  private constructor(deps: {
    ops: Pick<OpsApi, "admitBackOfficeStaff">;
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

  listIssuedLicenses: EnterpriseOpsApiContract["listIssuedLicenses"] = ({ operator, ...rest }) =>
    this.#licenses.list({ ...rest, operatorId: this.#staff(operator) });

  getIssuedLicense: EnterpriseOpsApiContract["getIssuedLicense"] = ({ operator, id }) =>
    this.#licenses.getById({ id, operatorId: this.#staff(operator) });

  issueLicense: EnterpriseOpsApiContract["issueLicense"] = ({ operator, ...rest }) =>
    this.#licenses.issue({ ...rest, operatorId: this.#staff(operator) });

  registerLegacyLicense: EnterpriseOpsApiContract["registerLegacyLicense"] = ({
    operator,
    ...rest
  }) => this.#licenses.registerLegacy({ ...rest, operatorId: this.#staff(operator) });

  revokeIssuedLicense: EnterpriseOpsApiContract["revokeIssuedLicense"] = ({ operator, ...rest }) =>
    this.#licenses.revoke({ ...rest, operatorId: this.#staff(operator) });

  reissueLicense: EnterpriseOpsApiContract["reissueLicense"] = ({ operator, ...rest }) =>
    this.#licenses.reissue({ ...rest, operatorId: this.#staff(operator) });

  changeLicenseSeats: EnterpriseOpsApiContract["changeLicenseSeats"] = ({ operator, ...rest }) =>
    this.#licenses.changeSeats({ ...rest, operatorId: this.#staff(operator) });

  resetLicenseInstanceBinding: EnterpriseOpsApiContract["resetLicenseInstanceBinding"] = ({
    operator,
    id,
  }) => this.#licenses.resetInstanceBinding({ id, operatorId: this.#staff(operator) });

  updateLicenseTerms: EnterpriseOpsApiContract["updateLicenseTerms"] = ({ operator, ...rest }) =>
    this.#licenses.updateTerms({ ...rest, operatorId: this.#staff(operator) });

  linkLicenseToOrganization: EnterpriseOpsApiContract["linkLicenseToOrganization"] = ({
    operator,
    ...rest
  }) => this.#licenses.linkToOrganization({ ...rest, operatorId: this.#staff(operator) });

  listActivationCodes: EnterpriseOpsApiContract["listActivationCodes"] = ({ operator, ...rest }) =>
    this.#licenses.activationCodes({ ...rest, operatorId: this.#staff(operator) });

  issueActivationCode: EnterpriseOpsApiContract["issueActivationCode"] = ({ operator, ...rest }) =>
    this.#licenses.issueActivationCode({ ...rest, operatorId: this.#staff(operator) });

  revokeActivationCode: EnterpriseOpsApiContract["revokeActivationCode"] = ({ operator, id }) =>
    this.#licenses.revokeActivationCode({ id, operatorId: this.#staff(operator) });

  listSelfHostedInstances: EnterpriseOpsApiContract["listSelfHostedInstances"] = ({
    operator,
    ...rest
  }) => this.#instances.list({ ...rest, operatorId: this.#staff(operator) });

  getSelfHostedInstance: EnterpriseOpsApiContract["getSelfHostedInstance"] = ({ operator, id }) =>
    this.#instances.getById({ id, operatorId: this.#staff(operator) });

  /** The staff member's id, or the back office's not-found. Throws synchronously, before any read. */
  #staff(operator: OpsOperator | null): string {
    return this.#ops.admitBackOfficeStaff(operator).id;
  }
}
