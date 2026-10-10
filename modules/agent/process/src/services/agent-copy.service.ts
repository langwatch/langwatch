import {
  AgentCopiesNotFoundError,
  AgentCopySelectionError,
  AgentIsNotCopyError,
  AgentRegisterOnlyError,
  type CopyAgentCommand,
  type PushAgentCopiesInput,
  type AgentReferenceInput,
  type Agent,
  type AgentCopyCreated,
  type AgentPushToCopies,
  type AgentSyncFromSource,
} from "@langwatch/agent-contract";

import type { AgentRepository, AgentCopyRecord } from "../repositories/agent.repository.ts";
import { nextAgentId } from "../rules/agent-id.rules.ts";
import { configForCopy } from "../rules/agent-secrets.rules.ts";
import type { AgentVoiceReleaseService } from "./agent-voice-release.service.ts";

export class AgentCopyService {
  #repository: AgentRepository;
  #voiceRelease: AgentVoiceReleaseService;

  private constructor({
    repository,
    voiceRelease,
  }: {
    repository: AgentRepository;
    voiceRelease: AgentVoiceReleaseService;
  }) {
    this.#repository = repository;
    this.#voiceRelease = voiceRelease;
  }

  static create({
    repository,
    voiceRelease,
  }: {
    repository: AgentRepository;
    /** A voice source lands in no receiving project whose voice flag is off. */
    voiceRelease: AgentVoiceReleaseService;
  }): AgentCopyService {
    return new AgentCopyService({ repository, voiceRelease });
  }

  getCopies(input: {
    sourceAgentId: string;
    allowedProjectIds?: string[];
  }): Promise<AgentCopyRecord[]> {
    return this.#repository
      .findCopies(input.sourceAgentId)
      .then((copies) =>
        input.allowedProjectIds
          ? copies.filter((copy) => input.allowedProjectIds?.includes(copy.projectId))
          : copies,
      );
  }

  /** Writes the copy's row; a workflow agent's graph was copied by workflow beforehand. */
  async createCopy(input: CopyAgentCommand): Promise<AgentCopyCreated> {
    const source = await this.#repository.getById({
      id: input.sourceAgentId,
      projectId: input.sourceProjectId,
    });
    if (source.type === "connected") throw new AgentRegisterOnlyError();
    await this.#voiceRelease.assertWritable({
      type: source.type,
      projectIds: [input.targetProjectId],
    });

    const copy = await this.#repository.create({
      id: input.newAgentId ?? nextAgentId(),
      projectId: input.targetProjectId,
      name: source.name,
      type: source.type,
      config: configForCopy({ source, targetProjectId: input.targetProjectId }),
      workflowId: input.workflowId,
      copiedFromAgentId: source.id,
    });

    return {
      id: copy.id,
      projectId: copy.projectId,
      name: copy.name,
      copiedFromAgentId: source.id,
    };
  }

  async pushToCopies(input: PushAgentCopiesInput): Promise<AgentPushToCopies> {
    const source = await this.#repository.getById({
      id: input.sourceAgentId,
      projectId: input.sourceProjectId,
    });
    const copies = await this.#repository.findCopies(input.sourceAgentId);
    if (copies.length === 0) throw new AgentCopiesNotFoundError(input.sourceAgentId);

    const selected = input.copyIds
      ? copies.filter((copy) => input.copyIds?.includes(copy.id))
      : copies;
    if (selected.length === 0) throw new AgentCopySelectionError(input.sourceAgentId);
    await this.#voiceRelease.assertWritable({
      type: source.type,
      projectIds: selected.map((copy) => copy.projectId),
    });

    for (const copy of selected) {
      const current = await this.#repository.getByIdIncludingArchived({
        id: copy.id,
        projectId: copy.projectId,
      });
      await this.#repository.updateNameAndConfig({
        id: copy.id,
        projectId: copy.projectId,
        name: source.name,
        config: configForCopy({ source, targetProjectId: copy.projectId, current }),
      });
    }

    return { pushedTo: selected.length, selectedCopies: input.copyIds?.length ?? copies.length };
  }

  async getSourceOfCopy(input: AgentReferenceInput): Promise<Agent> {
    const copy = await this.#repository.getById({ id: input.agentId, projectId: input.projectId });
    if (!copy.copiedFromAgentId) throw new AgentIsNotCopyError(input.agentId, input.projectId);

    return this.#repository.getByIdOnly(copy.copiedFromAgentId);
  }

  async syncFromSource(input: AgentReferenceInput): Promise<AgentSyncFromSource> {
    const source = await this.getSourceOfCopy(input);
    await this.#voiceRelease.assertWritable({ type: source.type, projectIds: [input.projectId] });
    const current = await this.#repository.getById({
      id: input.agentId,
      projectId: input.projectId,
    });
    await this.#repository.updateNameAndConfig({
      id: input.agentId,
      projectId: input.projectId,
      name: source.name,
      config: configForCopy({ source, targetProjectId: input.projectId, current }),
    });

    return { ok: true as const };
  }
}
