/**
 * What the organization copy reads and writes, held in memory: projects, evaluators, monitors,
 * prompts with versions, datasets with records and teams. Every id is fresh per catalog, so the
 * shared Postgres ledger never sees one twice across tests.
 */
import { randomUUID } from "node:crypto";

import type { DatasetApi } from "@langwatch/dataset-contract";
import type { Evaluator, EvaluatorApi } from "@langwatch/evaluator-contract";
import type { MonitorApi, MonitorWithEvaluator } from "@langwatch/monitor-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { Project, ProjectApi } from "@langwatch/project-contract";
import type { PromptApi, VersionedPrompt } from "@langwatch/prompt-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

const AT = new Date("2026-11-01T00:00:00Z");

export type CatalogProject = Project & { organizationId: string };
export type CatalogDataset = Readonly<{
  id: string;
  projectId: string;
  name: string;
  slug: string;
  status: string;
  records: Record<string, unknown>[];
}>;

export type CopyCatalog = ReturnType<typeof copyCatalog>;

export function copyCatalog() {
  const tag = randomUUID().slice(0, 8);
  const fresh = (prefix: string) => `${prefix}_${tag}_${randomUUID().slice(0, 8)}`;
  const data = {
    projects: [] as CatalogProject[],
    evaluators: [] as Evaluator[],
    monitors: [] as MonitorWithEvaluator[],
    prompts: [] as VersionedPrompt[],
    datasets: [] as CatalogDataset[],
    teams: [] as { id: string; organizationId: string }[],
  };

  function addProject({ organizationId, name }: { organizationId: string; name: string }) {
    const id = fresh("project");
    const project: CatalogProject = {
      id,
      name,
      slug: `${name}-${id.slice(-6)}`,
      apiKey: "",
      lwqlKey: "",
      teamId: fresh("team"),
      language: "python",
      framework: "openai",
      kind: "application",
      firstMessage: false,
      integrated: false,
      createdAt: AT,
      updatedAt: AT,
      userLinkTemplate: null,
      traceSharingEnabled: false,
      presenceEnabled: false,
      s3Endpoint: null,
      s3AccessKeyId: null,
      s3SecretAccessKey: null,
      s3Bucket: null,
      archivedAt: null,
      isPersonal: false,
      ownerUserId: null,
      personalFeatures: null,
      departmentId: null,
      langyEgressAllowlist: null,
      lastCodingAgentSessionAt: null,
      lastCodingAgentPullRequestAt: null,
      organizationId,
    };
    data.projects.push(project);
    return project;
  }

  function addEvaluator({
    projectId,
    name,
    type = "evaluator",
  }: {
    projectId: string;
    name: string;
    type?: Evaluator["type"];
  }) {
    const evaluator: Evaluator = {
      id: fresh("evaluator"),
      projectId,
      name,
      slug: name.toLowerCase().replace(/\s+/g, "-"),
      type,
      config: { evaluatorType: "langevals/exact_match", settings: {} },
      workflowId: type === "workflow" ? fresh("workflow") : null,
      copiedFromEvaluatorId: null,
      archivedAt: null,
      createdAt: AT,
      updatedAt: AT,
    };
    data.evaluators.push(evaluator);
    return evaluator;
  }

  function addMonitor({
    projectId,
    name,
    evaluatorId,
    experimentId = null,
  }: {
    projectId: string;
    name: string;
    evaluatorId: string | null;
    experimentId?: string | null;
  }) {
    const monitor = {
      id: fresh("monitor"),
      projectId,
      experimentId,
      evaluatorId,
      checkType: "langevals/exact_match",
      name,
      slug: name.toLowerCase().replace(/\s+/g, "-"),
      executionMode: "ON_MESSAGE",
      enabled: true,
      preconditions: [],
      parameters: {},
      mappings: null,
      sample: 1,
      level: "trace",
      threadIdleTimeout: null,
      createdAt: AT,
      updatedAt: AT,
      evaluator: null,
    } as MonitorWithEvaluator;
    data.monitors.push(monitor);
    return monitor;
  }

  function addPrompt({
    projectId,
    organizationId,
    handle,
    texts,
  }: {
    projectId: string;
    organizationId: string;
    handle: string;
    texts: string[];
  }) {
    const id = fresh("prompt");
    texts.forEach((text, index) => {
      data.prompts.push(promptVersion({ id, projectId, organizationId, handle, text, index }));
    });
    return id;
  }

  function promptVersion({
    id,
    projectId,
    organizationId,
    handle,
    text,
    index,
    commitMessage,
  }: {
    id: string;
    projectId: string;
    organizationId: string;
    handle: string;
    text: string;
    index: number;
    commitMessage?: string | null;
  }): VersionedPrompt {
    return {
      id,
      name: handle,
      handle,
      scope: "PROJECT",
      version: index + 1,
      versionId: fresh("version"),
      versionCreatedAt: AT,
      model: "openai/gpt-5-mini",
      prompt: text,
      projectId,
      organizationId,
      messages: [{ role: "system", content: text }],
      authorId: null,
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
      commitMessage: commitMessage ?? `v${index + 1}`,
      updatedAt: AT,
      createdAt: AT,
      tags: [],
      parameters: {},
    };
  }

  function addDataset({ projectId, name }: { projectId: string; name: string }) {
    const dataset: CatalogDataset = {
      id: fresh("dataset"),
      projectId,
      name,
      slug: name.toLowerCase().replace(/\s+/g, "-"),
      status: "ready",
      records: [{ input: "hi", expected_output: "hello" }],
    };
    data.datasets.push(dataset);
    return dataset;
  }

  const latest = (projectId: string) => {
    const byId = new Map<string, VersionedPrompt>();
    for (const version of data.prompts.filter((prompt) => prompt.projectId === projectId)) {
      const seen = byId.get(version.id);
      if (!seen || seen.version < version.version) byId.set(version.id, version);
    }
    return [...byId.values()];
  };

  const projects = {
    listByOrganization: async ({ organizationId }: { organizationId: string }) => ({
      data: [
        { id: `${organizationId}_project`, slug: "acme-support", name: "acme-support" },
        ...data.projects.filter((project) => project.organizationId === organizationId),
      ],
      pagination: { page: 1, limit: 100, total: 1 },
    }),
    findById: async (id: string) => data.projects.find((project) => project.id === id) ?? null,
    createInOrganization: async (input: {
      organizationId: string;
      teamId?: string;
      newTeamName?: string;
      name: string;
      language: string;
      framework: string;
    }) => {
      const project = addProject({ organizationId: input.organizationId, name: input.name });
      return { ...project, teamId: input.teamId ?? fresh("team") };
    },
  } satisfies Partial<Record<keyof ProjectApi, unknown>>;

  const organizations = {
    listTeams: async ({ organizationId }: { organizationId: string }) => ({
      data: data.teams
        .filter((team) => team.organizationId === organizationId)
        .map((team) => ({ ...team, isPersonal: false, archivedAt: null })),
      pagination: { page: 1, limit: 100, total: 0 },
    }),
  } satisfies Partial<Record<keyof OrganizationApi, unknown>>;

  const evaluators = createApiFixture<EvaluatorApi>({
    getAll: async ({ projectId }) =>
      data.evaluators.filter((evaluator) => evaluator.projectId === projectId),
    create: async (input) => {
      const evaluator: Evaluator = {
        id: input.id,
        projectId: input.projectId,
        name: input.name,
        slug: input.slug ?? null,
        type: input.type,
        config: input.config as Evaluator["config"],
        workflowId: input.workflowId ?? null,
        copiedFromEvaluatorId: input.copiedFromEvaluatorId ?? null,
        archivedAt: null,
        createdAt: AT,
        updatedAt: AT,
      };
      data.evaluators.push(evaluator);
      return evaluator;
    },
  });

  const monitors = createApiFixture<MonitorApi>({
    list: async ({ projectId }) =>
      data.monitors.filter((monitor) => monitor.projectId === projectId),
    create: async (input) => {
      const monitor = {
        ...addMonitor({
          projectId: input.projectId,
          name: input.name,
          evaluatorId: input.evaluatorId ?? null,
        }),
      };
      return monitor;
    },
    toggle: async ({ id, enabled }) => {
      const index = data.monitors.findIndex((monitor) => monitor.id === id);
      const found = data.monitors[index];
      if (found) data.monitors[index] = { ...found, enabled };
      return { success: true };
    },
  });

  const prompts = createApiFixture<PromptApi>({
    getAllPrompts: async ({ projectId }) => latest(projectId),
    getAllVersions: async ({ idOrHandle }) =>
      data.prompts.filter((prompt) => prompt.id === idOrHandle).toReversed(),
    createPrompt: async (input) => {
      const id = fresh("prompt");
      const version = promptVersion({
        id,
        projectId: input.projectId,
        organizationId: input.organizationId ?? "",
        handle: input.handle,
        text: input.prompt ?? "",
        index: 0,
        commitMessage: input.commitMessage ?? null,
      });
      data.prompts.push(version);
      return version;
    },
    updatePrompt: async (input) => {
      const versions = data.prompts.filter((prompt) => prompt.id === input.idOrHandle);
      const last = versions.at(-1);
      if (!last) throw new Error("no such prompt");
      const version = promptVersion({
        id: last.id,
        projectId: last.projectId,
        organizationId: last.organizationId,
        handle: last.handle ?? "",
        text: input.data.prompt ?? "",
        index: versions.length,
        commitMessage: input.data.commitMessage,
      });
      data.prompts.push(version);
      return version;
    },
  });

  const datasets = createApiFixture<DatasetApi>({
    findDatasetSummaries: async ({ projectId }) =>
      data.datasets
        .filter((dataset) => dataset.projectId === projectId)
        .map(({ id, name, slug, status }) => ({
          id,
          name,
          slug,
          status,
          columnTypes: [],
          createdAt: AT,
          updatedAt: AT,
        })) as never,
    copyDataset: async ({ sourceDatasetId, targetProjectId }) => {
      const source = data.datasets.find((dataset) => dataset.id === sourceDatasetId);
      if (!source) throw new Error("no such dataset");
      const copied = { ...source, id: fresh("dataset"), projectId: targetProjectId };
      data.datasets.push(copied);
      return { id: copied.id } as never;
    },
  });

  return {
    data,
    projects,
    organizations,
    evaluators,
    monitors,
    prompts,
    datasets,
    addProject,
    addEvaluator,
    addMonitor,
    addPrompt,
    addDataset,
    inProject: (projectId: string) => ({
      evaluators: data.evaluators.filter((evaluator) => evaluator.projectId === projectId),
      monitors: data.monitors.filter((monitor) => monitor.projectId === projectId),
      prompts: data.prompts.filter((prompt) => prompt.projectId === projectId),
      datasets: data.datasets.filter((dataset) => dataset.projectId === projectId),
    }),
  };
}
