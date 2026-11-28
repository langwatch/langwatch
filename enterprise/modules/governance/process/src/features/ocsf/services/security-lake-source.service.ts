// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { randomBytes } from "node:crypto";

import {
  type GovernanceIngestionSource,
  SECURITY_LAKE_ADAPTER_ID,
  SECURITY_LAKE_SOURCE_TYPE,
  securityLakePullConfigSchema,
  type SecurityLakeConnectionTest,
  type SecurityLakeConnectionTestInput,
  type SecurityLakeSource,
  type SecurityLakeSourceCreateInput,
  type SecurityLakeSourceHealth,
  type SecurityLakeSourceUpdateInput,
  IngestionSourceNotFoundError,
} from "@langwatch/enterprise-governance-contract";
import { PROJECT_KIND, type ProjectApi } from "@langwatch/project-contract";

import type { SecurityLakeQueue } from "../../../channels/security-lake-queue.channel.ts";
import type { SecurityLakeCallerRepository } from "../../../repositories/security-lake-caller.repository.ts";
import { describeAwsFailure } from "../rules/aws-failure.rules.ts";
import {
  SECURITY_LAKE_EXTERNAL_ID_KEY,
  securityLakeCredentialsOf,
} from "../rules/security-lake-credentials.rules.ts";
import { parseSecurityLakeHealth } from "../rules/security-lake-health.rules.ts";

type Scope = { organizationId: string };
type SecurityLakeEvents = Pick<SecurityLakeCallerRepository, "countSecurityLakeEvents">;

/** The ingestion source flow a Security Lake source is stored through. */
type IngestionSources = {
  createSource(input: {
    organizationId: string;
    actorUserId: string | null;
    sourceType: "security_lake";
    name: string;
    description?: string | null;
    parserConfig: Record<string, unknown>;
    pullSchedule: string;
  }): Promise<{ source: GovernanceIngestionSource }>;
  updateSource(input: {
    id: string;
    organizationId: string;
    name?: string;
    description?: string | null;
    parserConfig?: Record<string, unknown>;
    pullSchedule?: string;
    status?: "active" | "disabled";
  }): Promise<GovernanceIngestionSource>;
  findById(input: {
    id: string;
    organizationId: string;
  }): Promise<GovernanceIngestionSource | null>;
};

type PullRuns = {
  getLastPullOutcome(input: {
    id: string;
    organizationId: string;
  }): Promise<{ lastError: string | null }>;
};

/**
 * Creates, edits, tests and reports on Security Lake sources. A source is an ingestion source of
 * type security_lake whose pull schedule drives the reader.
 * Spec: enterprise/modules/governance/specs/security-lake-ingest.feature
 */
export class SecurityLakeSourceService {
  private constructor(
    private readonly deps: {
      sources: IngestionSources;
      pullRuns: PullRuns;
      queue: SecurityLakeQueue;
      events: SecurityLakeEvents;
      projects: Pick<ProjectApi, "findInternal">;
    },
  ) {}

  static create(deps: {
    sources: IngestionSources;
    pullRuns: PullRuns;
    queue: SecurityLakeQueue;
    events: SecurityLakeEvents;
    projects: Pick<ProjectApi, "findInternal">;
  }): SecurityLakeSourceService {
    return new SecurityLakeSourceService(deps);
  }

  /** The external id is generated here and sealed with the keys; a caller never picks it. */
  async create(
    input: SecurityLakeSourceCreateInput & Scope & { actorUserId: string | null },
  ): Promise<SecurityLakeSource> {
    const config = securityLakePullConfigSchema.parse({
      ...input.config,
      adapter: SECURITY_LAKE_ADAPTER_ID,
    });
    const externalId = generateExternalId();
    const { source } = await this.deps.sources.createSource({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      sourceType: SECURITY_LAKE_SOURCE_TYPE,
      name: input.name,
      ...(input.description === undefined ? {} : { description: input.description }),
      parserConfig: {
        ...config,
        credentials: { ...input.credentials, [SECURITY_LAKE_EXTERNAL_ID_KEY]: externalId },
      },
      pullSchedule: config.schedule,
    });
    return toSecurityLakeSource({ source, externalId });
  }

  async get(input: Scope & { id: string }): Promise<SecurityLakeSource> {
    const source = await this.load(input);
    return toSecurityLakeSource({ source, externalId: storedExternalId(source) });
  }

  /** New keys replace the stored ones; the external id stays as generated. */
  async update(
    input: SecurityLakeSourceUpdateInput & Scope & { id: string },
  ): Promise<SecurityLakeSource> {
    const stored = await this.load(input);
    const externalId = storedExternalId(stored);
    const parserConfig =
      input.config === undefined && input.credentials === undefined
        ? undefined
        : {
            ...mergedSettings({ stored, change: input.config }),
            ...(input.credentials === undefined
              ? {}
              : { credentials: withExternalId({ credentials: input.credentials, externalId }) }),
          };
    const source = await this.deps.sources.updateSource({
      id: input.id,
      organizationId: input.organizationId,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(parserConfig === undefined ? {} : { parserConfig }),
      ...(input.config?.schedule === undefined ? {} : { pullSchedule: input.config.schedule }),
      ...(input.status === undefined ? {} : { status: input.status }),
    });
    return toSecurityLakeSource({ source, externalId });
  }

  /**
   * Asks the subscriber queue for its backlog, never taking a message. Settings and keys sent are
   * tested over the stored ones and not saved, so the form is tested before Save.
   */
  async testConnection(
    input: SecurityLakeConnectionTestInput & Scope & { id: string },
  ): Promise<SecurityLakeConnectionTest> {
    const source = await this.load(input);
    const config = mergedSettings({ stored: source, change: input.config });
    const credentials =
      input.credentials === undefined
        ? credentialsOf(source.parserConfig.credentials)
        : withExternalId({ credentials: input.credentials, externalId: storedExternalId(source) });
    try {
      const backlog = await this.deps.queue.probe({
        queueUrl: config.queueUrl,
        region: config.region,
        ...(config.sqsEndpoint === undefined ? {} : { endpoint: config.sqsEndpoint }),
        credentials: securityLakeCredentialsOf(credentials, config),
      });
      return { ok: true, waiting: backlog.waiting, inFlight: backlog.inFlight, error: null };
    } catch (error) {
      return { ok: false, waiting: null, inFlight: null, error: describeAwsFailure(error) };
    }
  }

  /** The folded run health, with the written count read as the distinct events stored. */
  async health(input: Scope & { id: string }): Promise<SecurityLakeSourceHealth> {
    const source = await this.load(input);
    const [{ lastError }, written] = await Promise.all([
      this.deps.pullRuns.getLastPullOutcome(input),
      this.countWritten({ organizationId: input.organizationId, sourceId: source.id }),
    ]);
    const health = parseSecurityLakeHealth(
      typeof source.pollerCursor === "string" ? source.pollerCursor : null,
    );
    return {
      sourceId: source.id,
      status: source.status,
      lastError,
      health: { ...health, written },
    };
  }

  private async countWritten(input: { organizationId: string; sourceId: string }): Promise<number> {
    const tenant = await this.deps.projects.findInternal({
      organizationId: input.organizationId,
      kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
    });
    if (!tenant) return 0;
    return this.deps.events.countSecurityLakeEvents({
      tenantId: tenant.id,
      sourceId: input.sourceId,
    });
  }

  private async load(input: Scope & { id: string }): Promise<GovernanceIngestionSource> {
    const source = await this.deps.sources.findById(input);
    if (!source || source.sourceType !== SECURITY_LAKE_SOURCE_TYPE) {
      throw new IngestionSourceNotFoundError(input.id);
    }
    return source;
  }
}

function credentialsOf(value: unknown): Record<string, string> {
  if (value === null || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

/** `lw-` and 128 random bits in hex, the external id AWS compares with the trust policy. */
function generateExternalId(): string {
  return `lw-${randomBytes(16).toString("hex")}`;
}

function storedExternalId(source: GovernanceIngestionSource): string {
  return credentialsOf(source.parserConfig.credentials)[SECURITY_LAKE_EXTERNAL_ID_KEY] ?? "";
}

function withExternalId({
  credentials,
  externalId,
}: {
  credentials: Record<string, string | undefined>;
  externalId: string;
}): Record<string, string> {
  const keys = credentialsOf(credentials);
  return externalId ? { ...keys, [SECURITY_LAKE_EXTERNAL_ID_KEY]: externalId } : keys;
}

/** The stored settings with a change sent over them, keys sent as null removed. */
function mergedSettings({
  stored,
  change,
}: {
  stored: GovernanceIngestionSource;
  change: Record<string, unknown> | undefined;
}) {
  const { credentials: _credentials, ...settings } = stored.parserConfig;
  return securityLakePullConfigSchema.parse(withoutClearedOverrides({ ...settings, ...change }));
}

function toSecurityLakeSource({
  source,
  externalId,
}: {
  source: GovernanceIngestionSource;
  externalId: string;
}): SecurityLakeSource {
  const config = securityLakePullConfigSchema.parse(source.parserConfig);
  return {
    id: source.id,
    name: source.name,
    status: source.status,
    region: config.region,
    queueUrl: config.queueUrl,
    subscriberRoleArn: config.subscriberRoleArn,
    externalId,
    sources: config.sources,
    schedule: source.pullSchedule,
  };
}

/** The merged settings without the keys an update sent as null, which removes those overrides. */
function withoutClearedOverrides(settings: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== null));
}
