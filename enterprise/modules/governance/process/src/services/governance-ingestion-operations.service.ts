// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  GovernanceApi,
  GovernanceOttlGateway,
} from "@langwatch/enterprise-governance-contract";

import type { GovernanceEventingChannel } from "../app/governance.members.ts";
import type { CanonicalCostExtractorService } from "./canonical-cost-extractor.service.ts";
import type { IngestionSourceService } from "./ingestion-source.service.ts";
import type { IngestionTemplateService } from "./ingestion-template.service.ts";
import type { DefaultGovernanceOcsfExportService } from "./ocsf-export.service.ts";
import type { PersonalIngestionKeyService } from "./personal-ingestion-key.service.ts";

/** Private cohesive collaborator for the ingestion operation set. */
export class GovernanceIngestionOperationsService {
  private readonly canonicalCost: CanonicalCostExtractorService;
  private readonly eventing: GovernanceEventingChannel;
  private readonly ingestionKeys: PersonalIngestionKeyService;
  private readonly ingestionSources: IngestionSourceService;
  private readonly templates: IngestionTemplateService;
  private readonly ocsf: DefaultGovernanceOcsfExportService;
  private readonly ottl: GovernanceOttlGateway;

  private constructor({
    canonicalCost,
    eventing,
    ingestionKeys,
    ingestionSources,
    templates,
    ocsf,
    ottl,
  }: {
    canonicalCost: CanonicalCostExtractorService;
    eventing: GovernanceEventingChannel;
    ingestionKeys: PersonalIngestionKeyService;
    ingestionSources: IngestionSourceService;
    templates: IngestionTemplateService;
    ocsf: DefaultGovernanceOcsfExportService;
    ottl: GovernanceOttlGateway;
  }) {
    this.canonicalCost = canonicalCost;
    this.eventing = eventing;
    this.ingestionKeys = ingestionKeys;
    this.ingestionSources = ingestionSources;
    this.templates = templates;
    this.ocsf = ocsf;
    this.ottl = ottl;
  }

  static create({
    canonicalCost,
    eventing,
    ingestionKeys,
    ingestionSources,
    templates,
    ocsf,
    ottl,
  }: {
    canonicalCost: CanonicalCostExtractorService;
    eventing: GovernanceEventingChannel;
    ingestionKeys: PersonalIngestionKeyService;
    ingestionSources: IngestionSourceService;
    templates: IngestionTemplateService;
    ocsf: DefaultGovernanceOcsfExportService;
    ottl: GovernanceOttlGateway;
  }): GovernanceIngestionOperationsService {
    return new GovernanceIngestionOperationsService({
      canonicalCost,
      eventing,
      ingestionKeys,
      ingestionSources,
      templates,
      ocsf,
      ottl,
    });
  }

  readonly extractCanonicalCostEvents: GovernanceApi["extractCanonicalCostEvents"] = (...args) =>
    this.canonicalCost.extract(...args);

  readonly ingestionConfigure: GovernanceApi["ingestionConfigure"] = (...args) =>
    this.eventing.configureIngestion(...args);

  readonly ingestionDisable: GovernanceApi["ingestionDisable"] = (...args) =>
    this.eventing.disableIngestion(...args);

  readonly ingestionRecordRunCompleted: GovernanceApi["ingestionRecordRunCompleted"] = (...args) =>
    this.eventing.recordIngestionRunCompleted(...args);

  readonly ingestionRecordRunFailed: GovernanceApi["ingestionRecordRunFailed"] = (...args) =>
    this.eventing.recordIngestionRunFailed(...args);

  readonly usageRecord: GovernanceApi["usageRecord"] = (...args) =>
    this.eventing.recordPulledUsage(...args);

  readonly ingestionKeyIssueForProject: GovernanceApi["ingestionKeyIssueForProject"] = (...args) =>
    this.ingestionKeys.issueForProject(...args);

  readonly ingestionKeyIssueForPersonalProject: GovernanceApi["ingestionKeyIssueForPersonalProject"] =
    (...args) => this.ingestionKeys.mint(...args);

  readonly ingestionKeyListForPersonalProject: GovernanceApi["ingestionKeyListForPersonalProject"] =
    (...args) => this.ingestionKeys.list(...args);

  readonly getPersonalIngestionKeyState: GovernanceApi["getPersonalIngestionKeyState"] = (
    ...args
  ) => this.ingestionKeys.getPersonalKeyState(...args);

  readonly ingestionSourceList: GovernanceApi["ingestionSourceList"] = (...args) =>
    this.ingestionSources.list(...args);

  readonly findIngestionSourceById: GovernanceApi["findIngestionSourceById"] = (...args) =>
    this.ingestionSources.findById(...args);

  readonly ingestionSourceGetById: GovernanceApi["ingestionSourceGetById"] = (...args) =>
    this.ingestionSources.getById(...args);

  readonly ingestionSourceLiveTraceProjectIds: GovernanceApi["ingestionSourceLiveTraceProjectIds"] =
    (...args) => this.ingestionSources.liveTraceProjectIds(...args);

  readonly findIngestionSourceByIngestSecret: GovernanceApi["findIngestionSourceByIngestSecret"] = (
    ...args
  ) => this.ingestionSources.findByIngestSecret(...args);

  readonly ingestionSourceCreate: GovernanceApi["ingestionSourceCreate"] = (...args) =>
    this.ingestionSources.createSource(...args);

  readonly ingestionSourceUpdate: GovernanceApi["ingestionSourceUpdate"] = (...args) =>
    this.ingestionSources.updateSource(...args);

  readonly ingestionSourceRotateSecret: GovernanceApi["ingestionSourceRotateSecret"] = (...args) =>
    this.ingestionSources.rotateSecret(...args);

  readonly ingestionSourceArchive: GovernanceApi["ingestionSourceArchive"] = (...args) =>
    this.ingestionSources.archive(...args);

  readonly ingestionSourceRecordEventReceived: GovernanceApi["ingestionSourceRecordEventReceived"] =
    (...args) => this.ingestionSources.recordEventReceived(...args);

  readonly templateListForUser: GovernanceApi["templateListForUser"] = (...args) =>
    this.templates.listForUser(...args);

  readonly templateListForOrgAdmin: GovernanceApi["templateListForOrgAdmin"] = (...args) =>
    this.templates.listForOrgAdmin(...args);

  readonly findTemplateByIdForOrg: GovernanceApi["findTemplateByIdForOrg"] = (...args) =>
    this.templates.findByIdForOrg(...args);

  readonly templateGetByIdForOrg: GovernanceApi["templateGetByIdForOrg"] = (...args) =>
    this.templates.getByIdForOrg(...args);

  readonly templateCreateOrg: GovernanceApi["templateCreateOrg"] = (...args) =>
    this.templates.createOrgTemplate(...args);

  readonly templateUpdateOttlRules: GovernanceApi["templateUpdateOttlRules"] = (...args) =>
    this.templates.updateOttlRules(...args);

  readonly templateArchiveOrg: GovernanceApi["templateArchiveOrg"] = (...args) =>
    this.templates.archiveOrgTemplate(...args);

  readonly templateCloneFromPlatform: GovernanceApi["templateCloneFromPlatform"] = (...args) =>
    this.templates.cloneFromPlatform(...args);

  readonly templateSyncPlatformCatalog: GovernanceApi["templateSyncPlatformCatalog"] = (...args) =>
    this.templates.syncPlatformCatalog(...args);

  readonly ocsfList: GovernanceApi["ocsfList"] = (...args) => this.ocsf.list(...args);

  readonly ottlValidate: GovernanceApi["ottlValidate"] = (...args) => this.ottl.validate(...args);

  readonly ottlTransform: GovernanceApi["ottlTransform"] = (...args) =>
    this.ottl.transform(...args);
}
