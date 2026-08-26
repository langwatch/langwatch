// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { GovernanceService } from "@langwatch/enterprise-governance-contract";
import type { CanonicalCostExtractorService } from "./canonical-cost-extractor.service";
import type { GovernanceEventingPort } from "../ports/governance-eventing.port";
import type { IngestionKeyService } from "./ingestion-source-key.service";
import type { IngestionSourceService } from "./ingestion-source.service";
import type { IngestionTemplateService } from "./ingestion-template.service";
import type { DefaultGovernanceOcsfExportService } from "./ocsf-export.service";
import type { GovernanceOttlGateway } from "@langwatch/enterprise-governance-contract";

/** Private cohesive collaborator for the ingestion operation set. */
export class GovernanceIngestionOperationsService {
  private constructor(
    private readonly canonicalCost: CanonicalCostExtractorService,
    private readonly eventing: GovernanceEventingPort,
    private readonly ingestionKeys: IngestionKeyService,
    private readonly ingestionSources: IngestionSourceService,
    private readonly templates: IngestionTemplateService,
    private readonly ocsf: DefaultGovernanceOcsfExportService,
    private readonly ottl: GovernanceOttlGateway,
  ) {}

  static create(
    canonicalCost: CanonicalCostExtractorService,
    eventing: GovernanceEventingPort,
    ingestionKeys: IngestionKeyService,
    ingestionSources: IngestionSourceService,
    templates: IngestionTemplateService,
    ocsf: DefaultGovernanceOcsfExportService,
    ottl: GovernanceOttlGateway,
  ): GovernanceIngestionOperationsService {
    return new GovernanceIngestionOperationsService(
      canonicalCost,
      eventing,
      ingestionKeys,
      ingestionSources,
      templates,
      ocsf,
      ottl,
    );
  }

  readonly extractCanonicalCostEvents: GovernanceService["extractCanonicalCostEvents"] = (
    ...args
  ) => this.canonicalCost.extract(...args);

  readonly ingestionConfigure: GovernanceService["ingestionConfigure"] = (...args) =>
    this.eventing.configureIngestion(...args);

  readonly ingestionDisable: GovernanceService["ingestionDisable"] = (...args) =>
    this.eventing.disableIngestion(...args);

  readonly ingestionRecordRunCompleted: GovernanceService["ingestionRecordRunCompleted"] =
    (...args) => this.eventing.recordIngestionRunCompleted(...args);

  readonly ingestionRecordRunFailed: GovernanceService["ingestionRecordRunFailed"] = (
    ...args
  ) => this.eventing.recordIngestionRunFailed(...args);

  readonly usageRecord: GovernanceService["usageRecord"] = (...args) =>
    this.eventing.recordPulledUsage(...args);

  readonly ingestionKeyEnsureForProject: GovernanceService["ingestionKeyEnsureForProject"] =
    (...args) => this.ingestionKeys.ensureForProject(...args);

  readonly ingestionKeyIssueForProject: GovernanceService["ingestionKeyIssueForProject"] =
    (...args) => this.ingestionKeys.issueForProject(...args);

  readonly ingestionKeyEnsureForPersonalProject: GovernanceService["ingestionKeyEnsureForPersonalProject"] =
    (...args) => this.ingestionKeys.ensureForPersonalProject(...args);

  readonly ingestionKeyListForPersonalProject: GovernanceService["ingestionKeyListForPersonalProject"] =
    (...args) => this.ingestionKeys.listForPersonalProject(...args);

  readonly ingestionSourceList: GovernanceService["ingestionSourceList"] = (...args) =>
    this.ingestionSources.list(...args);

  readonly tryFindIngestionSourceById: GovernanceService["tryFindIngestionSourceById"] = (
    ...args
  ) => this.ingestionSources.tryFindById(...args);

  readonly ingestionSourceGetById: GovernanceService["ingestionSourceGetById"] = (
    ...args
  ) => this.ingestionSources.getById(...args);

  readonly tryFindIngestionSourceByIngestSecret: GovernanceService["tryFindIngestionSourceByIngestSecret"] =
    (...args) => this.ingestionSources.tryFindByIngestSecret(...args);

  readonly ingestionSourceCreate: GovernanceService["ingestionSourceCreate"] = (
    ...args
  ) => this.ingestionSources.createSource(...args);

  readonly ingestionSourceUpdate: GovernanceService["ingestionSourceUpdate"] = (
    ...args
  ) => this.ingestionSources.updateSource(...args);

  readonly ingestionSourceRotateSecret: GovernanceService["ingestionSourceRotateSecret"] =
    (...args) => this.ingestionSources.rotateSecret(...args);

  readonly ingestionSourceArchive: GovernanceService["ingestionSourceArchive"] = (
    ...args
  ) => this.ingestionSources.archive(...args);

  readonly ingestionSourceRecordEventReceived: GovernanceService["ingestionSourceRecordEventReceived"] =
    (...args) => this.ingestionSources.recordEventReceived(...args);

  readonly templateListForUser: GovernanceService["templateListForUser"] = (...args) =>
    this.templates.listForUser(...args);

  readonly templateListForOrgAdmin: GovernanceService["templateListForOrgAdmin"] = (
    ...args
  ) => this.templates.listForOrgAdmin(...args);

  readonly tryFindTemplateByIdForOrg: GovernanceService["tryFindTemplateByIdForOrg"] = (
    ...args
  ) => this.templates.tryFindByIdForOrg(...args);

  readonly templateGetByIdForOrg: GovernanceService["templateGetByIdForOrg"] = (
    ...args
  ) => this.templates.getByIdForOrg(...args);

  readonly templateCreateOrg: GovernanceService["templateCreateOrg"] = (...args) =>
    this.templates.createOrgTemplate(...args);

  readonly templateUpdateOttlRules: GovernanceService["templateUpdateOttlRules"] = (
    ...args
  ) => this.templates.updateOttlRules(...args);

  readonly templateArchiveOrg: GovernanceService["templateArchiveOrg"] = (...args) =>
    this.templates.archiveOrgTemplate(...args);

  readonly templateCloneFromPlatform: GovernanceService["templateCloneFromPlatform"] = (
    ...args
  ) => this.templates.cloneFromPlatform(...args);

  readonly templateSyncPlatformCatalog: GovernanceService["templateSyncPlatformCatalog"] =
    (...args) => this.templates.syncPlatformCatalog(...args);

  readonly ocsfList: GovernanceService["ocsfList"] = (...args) => this.ocsf.list(...args);

  readonly ottlValidate: GovernanceService["ottlValidate"] = (...args) =>
    this.ottl.validate(...args);

  readonly ottlTransform: GovernanceService["ottlTransform"] = (...args) =>
    this.ottl.transform(...args);
}
