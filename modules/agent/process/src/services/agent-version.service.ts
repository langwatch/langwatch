import {
  AGENT_SEEDED_LABELS,
  AgentDeployedLabelProtectedError,
  AgentLabelInvalidError,
  AgentVersionNotFoundError,
  AgentVersionSelectorConflictError,
  AgentVersionUnsupportedError,
  agentLabelProblem,
  agentSchema,
  parseAgentAddress,
  parseAgentConfig,
  type Agent,
  type AgentCaller,
  type AgentLabel,
  type AgentVersion,
  type AgentVersions,
  type AgentVersionSelector,
} from "@langwatch/agent-contract";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { UserApi } from "@langwatch/user-contract";

import type { AgentRepository, AgentVersionRecord } from "../repositories/agent.repository.ts";

/** An agent as one of its versions holds it; `version` is null for a connected agent. */
export type ResolvedAgentVersion = { agent: Agent; version: number | null };

const BACKFILL_PAGE = 200;

/** Versions, deploy labels and the deploy check of agents (spec: agent-versioning.feature). */
export class AgentVersionService {
  readonly #repository: AgentRepository;
  readonly #users: Pick<UserApi, "getProfiles">;
  readonly #permissions: Pick<AuthzApi, "can" | "getScope">;
  readonly #auditLog: Pick<AuditLogApi, "listEntityHistory">;

  private constructor(input: {
    repository: AgentRepository;
    users: Pick<UserApi, "getProfiles">;
    permissions: Pick<AuthzApi, "can" | "getScope">;
    auditLog: Pick<AuditLogApi, "listEntityHistory">;
  }) {
    this.#repository = input.repository;
    this.#users = input.users;
    this.#permissions = input.permissions;
    this.#auditLog = input.auditLog;
  }

  static create(input: {
    repository: AgentRepository;
    users: Pick<UserApi, "getProfiles">;
    permissions: Pick<AuthzApi, "can" | "getScope">;
    auditLog: Pick<AuditLogApi, "listEntityHistory">;
  }): AgentVersionService {
    return new AgentVersionService(input);
  }

  async listVersions(input: { projectId: string; agentId: string }): Promise<AgentVersions> {
    const agent = await this.#repository.getById({ id: input.agentId, projectId: input.projectId });
    if (agent.type === "connected") return { versions: [], labels: [], availableLabels: [] };
    const [versions, labels] = await Promise.all([
      this.#repository.listVersions(input),
      this.#repository.listLabels({ projectId: input.projectId, ids: [input.agentId] }),
    ]);
    const people = await this.#people(
      versions.flatMap((row) => (row.authorId ? [row.authorId] : [])),
    );
    const labelsByVersion = new Map<string, string[]>();
    for (const label of labels) {
      labelsByVersion.set(label.versionId, [
        ...(labelsByVersion.get(label.versionId) ?? []),
        label.label,
      ]);
    }

    return {
      versions: versions.map((row): AgentVersion => ({
        ...row,
        author: row.authorId ? (people.get(row.authorId) ?? null) : null,
        labels: labelsByVersion.get(row.id) ?? [],
      })),
      labels: labels.map(({ agentId: _agentId, ...label }): AgentLabel => label),
      availableLabels: [...new Set([...AGENT_SEEDED_LABELS, ...labels.map((row) => row.label)])],
    };
  }

  /**
   * The agent at a label or version, from `?label=`/`?version=` or the `id:label` address.
   * Neither reads the row itself, the latest.
   */
  async resolve(
    input: { projectId: string; address: string } & AgentVersionSelector,
  ): Promise<ResolvedAgentVersion> {
    const address = parseAgentAddress(input.address);
    const asked = [input.label, input.version].filter((value) => value !== void 0).length;
    if (asked > 1 || (address.hadSuffix && asked > 0)) {
      throw new AgentVersionSelectorConflictError();
    }
    const label = address.label ?? input.label;
    const version = address.version ?? input.version;
    const agent = await this.#repository.getById({ id: address.id, projectId: input.projectId });
    if (agent.type === "connected") {
      if (label !== void 0 || version !== void 0) {
        throw new AgentVersionUnsupportedError({ agentId: agent.id });
      }
      return { agent, version: null };
    }
    if (label === void 0 && version === void 0) {
      const latest = await this.#repository.latestVersionNumbers({
        projectId: input.projectId,
        ids: [agent.id],
      });
      return { agent, version: latest.get(agent.id) ?? null };
    }

    const row = await this.#versionAt({ agent, label, version });
    return {
      agent: agentSchema.parse({
        ...agent,
        name: row.name,
        type: row.type,
        config: parseAgentConfig(row.type, row.config),
        workflowId: row.workflowId,
      }),
      version: row.version,
    };
  }

  async assignLabel(input: {
    projectId: string;
    agentId: string;
    label: string;
    version: number;
    caller?: AgentCaller;
  }): Promise<AgentLabel> {
    const problem = agentLabelProblem(input.label);
    if (problem) throw new AgentLabelInvalidError({ label: input.label, reason: problem });
    const agent = await this.#repository.getById({ id: input.agentId, projectId: input.projectId });
    if (agent.type === "connected") throw new AgentVersionUnsupportedError({ agentId: agent.id });
    const row = await this.#repository.findVersion({
      projectId: input.projectId,
      agentId: input.agentId,
      version: input.version,
    });
    if (!row) throw new AgentVersionNotFoundError({ agentId: agent.id, version: input.version });
    const { agentId: _agentId, ...label } = await this.#repository.assignLabel({
      projectId: input.projectId,
      agentId: input.agentId,
      label: input.label,
      versionId: row.id,
      actorId: input.caller?.type === "user" ? input.caller.id : null,
    });
    return label;
  }

  async removeLabel(input: { projectId: string; agentId: string; label: string }): Promise<void> {
    await this.#repository.getById({ id: input.agentId, projectId: input.projectId });
    const removed = await this.#repository.removeLabel(input);
    if (!removed)
      throw new AgentVersionNotFoundError({ agentId: input.agentId, label: input.label });
  }

  /** The latest number and the labels of each agent, for list rows. */
  async summaries(input: {
    projectId: string;
    ids: string[];
  }): Promise<
    Map<string, { version: number | null; labels: { label: string; version: number }[] }>
  > {
    const [numbers, labels] = await Promise.all([
      this.#repository.latestVersionNumbers(input),
      this.#repository.listLabels(input),
    ]);
    return new Map(
      input.ids.map((id) => [
        id,
        {
          version: numbers.get(id) ?? null,
          labels: labels
            .filter((label) => label.agentId === id)
            .map(({ label, version }) => ({ label, version })),
        },
      ]),
    );
  }

  /**
   * Archiving an agent a label points at needs `agents:deploy`; the check depends on the
   * loaded row, so the service asks it. A peer's cascade names no caller and is not asked.
   */
  async assertArchivable(input: {
    projectId: string;
    agentId: string;
    caller?: AgentCaller;
  }): Promise<void> {
    if (!input.caller || input.caller.type === "system") return;
    const labels = await this.#repository.listLabels({
      projectId: input.projectId,
      ids: [input.agentId],
    });
    if (labels.length === 0) return;
    const scope = await this.#permissions.getScope({ projectId: input.projectId });
    const permitted = await this.#permissions.can({
      principal:
        input.caller.type === "user"
          ? { type: "user", id: input.caller.id }
          : { type: "apiKey", id: input.caller.id },
      permission: "agents:deploy",
      scope,
    });
    if (!permitted) {
      throw new AgentDeployedLabelProtectedError({
        agentId: input.agentId,
        labels: labels.map((label) => label.label),
      });
    }
  }

  /**
   * Version 1 for every agent written before versions existed, its creator read from the
   * earliest `agents.create` audit entry. Writes nothing on a dry run; a re-run writes nothing.
   */
  async backfill(input: {
    dryRun: boolean;
    signal: AbortSignal;
    afterId: string | null;
    onPage: (report: { afterId: string; written: number; scanned: number }) => Promise<void>;
  }): Promise<{ written: number; scanned: number; wouldWrite: number }> {
    let afterId = input.afterId;
    let written = 0;
    let scanned = 0;
    let wouldWrite = 0;
    while (!input.signal.aborted) {
      const page = await this.#repository.findUnversioned({ afterId, limit: BACKFILL_PAGE });
      if (page.length === 0) break;
      for (const agent of page) {
        scanned += 1;
        if (input.dryRun) {
          const versions = await this.#repository.latestVersionNumbers({
            projectId: agent.projectId,
            ids: [agent.id],
          });
          if (!versions.has(agent.id)) wouldWrite += 1;
          continue;
        }
        const createdById = agent.createdById ?? (await this.#creatorOf(agent));
        if (await this.#repository.backfillFirstVersion({ agent, createdById })) written += 1;
      }
      afterId = page.at(-1)!.id;
      if (!input.dryRun) await input.onPage({ afterId, written, scanned });
    }
    return { written, scanned, wouldWrite };
  }

  async #creatorOf(agent: Agent): Promise<string | null> {
    const entries = await this.#auditLog.listEntityHistory({
      projectId: agent.projectId,
      entityId: agent.id,
      argumentNames: ["id", "agentId"],
      actionPrefix: "agents.create",
      limit: 100,
    });
    const [earliest] = entries
      .filter((entry) => entry.action === "agents.create" && entry.userId)
      .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return earliest?.userId ?? null;
  }

  async #versionAt(input: {
    agent: Agent;
    label: string | undefined;
    version: number | undefined;
  }): Promise<AgentVersionRecord> {
    const { agent } = input;
    if (input.version !== void 0) {
      const row = await this.#repository.findVersion({
        projectId: agent.projectId,
        agentId: agent.id,
        version: input.version,
      });
      if (!row) throw new AgentVersionNotFoundError({ agentId: agent.id, version: input.version });
      return row;
    }
    const [label] = (
      await this.#repository.listLabels({ projectId: agent.projectId, ids: [agent.id] })
    ).filter((row) => row.label === input.label);
    const row = label
      ? await this.#repository.findVersion({
          projectId: agent.projectId,
          agentId: agent.id,
          versionId: label.versionId,
        })
      : void 0;
    if (!row) throw new AgentVersionNotFoundError({ agentId: agent.id, label: input.label });
    return row;
  }

  async #people(ids: string[]) {
    const unique = [...new Set(ids)];
    const users = unique.length ? await this.#users.getProfiles({ userIds: unique }) : [];
    return new Map(
      users.map((user) => [user.id, { id: user.id, name: user.name, email: user.email }]),
    );
  }
}
