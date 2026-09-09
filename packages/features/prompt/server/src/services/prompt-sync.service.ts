/** Reconciling a prompt held in a local file with the one on the server. */
import {
  diffRuntimeParameters,
  type getLatestConfigVersionSchema,
  type LatestConfigVersionSchema,
  type PromptScope,
  runtimeParametersEqual,
} from "@langwatch/prompt-contract";
import type { z } from "zod";
import { describeLocalFileUpdate } from "../rules/prompt-describe-local-file-update.rules.ts";
import { mergeAutoDetectedInputs } from "../rules/prompt-merge-auto-detected-inputs.rules.ts";
import { transformSnakeToCamel } from "../rules/prompt-transform-db.rules.ts";
import type { LlmConfigRepository } from "../repositories/prompt.repository.ts";
import { remoteConfigDataOf } from "../rules/prompt-sync.rules.ts";
import type { PromptReadService } from "./prompt-read.service.ts";
import type { PromptWriteService } from "./prompt-write.service.ts";
import type { VersionedPrompt } from "./prompt.service.ts";

export type ConfigData = z.infer<ReturnType<typeof getLatestConfigVersionSchema>>["configData"];

/** The local file's config data with the inputs its prompt and messages imply merged in. */
function mergeInputsIntoConfigData(localConfigData: ConfigData): ConfigData {
  return {
    ...localConfigData,
    inputs: mergeAutoDetectedInputs({
      prompt: localConfigData.prompt,
      messages: localConfigData.messages ?? [],
      inputs: localConfigData.inputs ?? [],
    }),
  };
}

export class PromptSyncService {
  private readonly repository: LlmConfigRepository;
  private readonly read: PromptReadService;
  private readonly write: PromptWriteService;

  static create(options: {
    repository: LlmConfigRepository;
    read: PromptReadService;
    write: PromptWriteService;
  }): PromptSyncService {
    return new PromptSyncService(options);
  }

  private constructor(options: {
    repository: LlmConfigRepository;
    read: PromptReadService;
    write: PromptWriteService;
  }) {
    this.repository = options.repository;
    this.read = options.read;
    this.write = options.write;
  }

  /**
   * Converts the snake_case sync payload to the camelCase named parameters `createPrompt`
   * takes: without it, a key like `max_tokens` is invisible to `maxTokens` and its value is
   * silently lost.
   */
  private async createSyncedPrompt({
    idOrHandle,
    resolvedConfigData,
    projectId,
    organizationId,
    authorId,
    commitMessage,
    parameters,
  }: {
    idOrHandle: string;
    resolvedConfigData: ConfigData;
    projectId: string;
    organizationId: string;
    authorId?: string;
    commitMessage?: string;
    parameters?: Record<string, unknown>;
  }): Promise<VersionedPrompt> {
    const camelCaseData = transformSnakeToCamel(
      resolvedConfigData as unknown as Record<string, unknown>,
    );

    return this.write.createPrompt({
      handle: idOrHandle,
      projectId,
      organizationId,
      scope: "PROJECT" as PromptScope,
      authorId,
      commitMessage: commitMessage ?? "Synced from local file",
      parameters,
      ...camelCaseData,
    });
  }

  /** Same version on both sides: up to date when the content agrees, a new version when not. */
  private async syncSameVersion({
    existingPrompt,
    resolvedConfigData,
    remoteConfigData,
    parameters,
    projectId,
    authorId,
    commitMessage,
  }: {
    existingPrompt: VersionedPrompt;
    resolvedConfigData: ConfigData;
    remoteConfigData: LatestConfigVersionSchema["configData"];
    parameters?: Record<string, unknown>;
    projectId: string;
    authorId?: string;
    commitMessage?: string;
  }): Promise<{ action: "updated" | "up_to_date"; prompt: VersionedPrompt }> {
    const comparison = this.repository.compareConfigContent(resolvedConfigData, remoteConfigData);
    const parametersEqual = runtimeParametersEqual(parameters, existingPrompt.parameters);
    if (comparison.isEqual && parametersEqual) {
      return { action: "up_to_date", prompt: existingPrompt };
    }

    const allDifferences = [
      ...(comparison.differences ?? []),
      ...diffRuntimeParameters({
        localParameters: parameters,
        remoteParameters: existingPrompt.parameters,
      }),
    ];

    return {
      action: "updated",
      prompt: await this.write.updatePrompt({
        idOrHandle: existingPrompt.id,
        projectId,
        data: {
          authorId,
          commitMessage: commitMessage ?? describeLocalFileUpdate(allDifferences),
          ...this.write.transformToDbFormat(resolvedConfigData),
          parameters,
        },
      }),
    };
  }

  /**
   * Local is behind remote: safe to fast-forward when the local file has not changed since the
   * version it was taken from, and a conflict when it has.
   */
  private async syncBehindRemote({
    existingPrompt,
    idOrHandle,
    localVersion,
    remoteVersion,
    remoteConfigData,
    resolvedConfigData,
    parameters,
    projectId,
    organizationId,
  }: {
    existingPrompt: VersionedPrompt;
    idOrHandle: string;
    localVersion: number;
    remoteVersion: number;
    remoteConfigData: LatestConfigVersionSchema["configData"];
    resolvedConfigData: ConfigData;
    parameters?: Record<string, unknown>;
    projectId: string;
    organizationId: string;
  }): Promise<{
    action: "conflict" | "up_to_date";
    prompt?: VersionedPrompt;
    conflictInfo?: {
      localVersion: number;
      remoteVersion: number;
      differences: string[];
      remoteConfigData: ConfigData;
      remoteParameters: Record<string, unknown>;
    };
  }> {
    const localBaseVersion = await this.repository.tryGetConfigVersionByNumber({
      idOrHandle,
      versionNumber: localVersion,
      projectId,
      organizationId,
    });
    if (localBaseVersion) {
      const baseComparison = this.repository.compareConfigContent(
        resolvedConfigData,
        localBaseVersion.configData as Record<string, unknown>,
      );
      const baseParametersEqual = runtimeParametersEqual(
        parameters,
        localBaseVersion.runtimeParameters as Record<string, unknown> | undefined,
      );
      if (baseComparison.isEqual && baseParametersEqual) {
        return { action: "up_to_date", prompt: existingPrompt };
      }
    }

    return {
      action: "conflict",
      conflictInfo: this.conflictInfoFor({
        localVersion,
        remoteVersion,
        resolvedConfigData,
        remoteConfigData,
        existingPrompt,
      }),
    };
  }

  /** What the caller is told when the two sides moved apart: the versions and what differs. */
  private conflictInfoFor({
    localVersion,
    remoteVersion,
    resolvedConfigData,
    remoteConfigData,
    existingPrompt,
  }: {
    localVersion: number;
    remoteVersion: number;
    resolvedConfigData: ConfigData;
    remoteConfigData: LatestConfigVersionSchema["configData"];
    existingPrompt: VersionedPrompt;
  }): {
    localVersion: number;
    remoteVersion: number;
    differences: string[];
    remoteConfigData: ConfigData;
    remoteParameters: Record<string, unknown>;
  } {
    return {
      localVersion,
      remoteVersion,
      differences:
        this.repository.compareConfigContent(resolvedConfigData, remoteConfigData).differences ??
        [],
      remoteConfigData,
      remoteParameters: existingPrompt.parameters ?? {},
    };
  }

  /**
   * Syncs a prompt from a local source: skipped when versions match, updated
   * when local is newer, and reported as a conflict when local is older.
   */
  async syncPrompt(params: {
    idOrHandle: string;
    localConfigData: ConfigData;
    localVersion?: number;
    projectId: string;
    organizationId: string;
    authorId?: string;
    commitMessage?: string;
    parameters?: Record<string, unknown>;
  }): Promise<{
    action: "created" | "updated" | "conflict" | "up_to_date";
    prompt?: VersionedPrompt;
    conflictInfo?: {
      localVersion: number;
      remoteVersion: number;
      differences: string[];
      remoteConfigData: ConfigData;
      remoteParameters: Record<string, unknown>;
    };
  }> {
    const {
      idOrHandle,
      localConfigData,
      localVersion,
      projectId,
      organizationId,
      authorId,
      commitMessage,
    } = params;

    // Must run before comparison/creation so both code paths use the merged inputs.
    const resolvedConfigData = mergeInputsIntoConfigData(localConfigData);

    // Check if prompt exists on server
    const existingPrompt = await this.read.tryGetPromptByIdOrHandle({
      idOrHandle,
      projectId,
      organizationId,
    });

    if (!existingPrompt) {
      return {
        action: "created",
        prompt: await this.createSyncedPrompt({ ...params, resolvedConfigData }),
      };
    }

    // Check modify permissions
    await this.write.assertModifyPermission({
      idOrHandle,
      projectId,
      organizationId: organizationId,
    });

    const remoteVersion = existingPrompt.version;

    const remoteConfigData = remoteConfigDataOf(existingPrompt);

    if (localVersion === remoteVersion) {
      return this.syncSameVersion({
        existingPrompt,
        resolvedConfigData,
        remoteConfigData,
        parameters: params.parameters,
        projectId,
        authorId,
        commitMessage,
      });
    }

    if (localVersion && localVersion < remoteVersion) {
      return this.syncBehindRemote({
        existingPrompt,
        idOrHandle,
        localVersion,
        remoteVersion,
        remoteConfigData,
        resolvedConfigData,
        parameters: params.parameters,
        projectId,
        organizationId,
      });
    }

    // Case 4: Local version is newer or unknown - assume conflict
    return {
      action: "conflict",
      conflictInfo: this.conflictInfoFor({
        localVersion: localVersion ?? 0,
        remoteVersion,
        resolvedConfigData,
        remoteConfigData,
        existingPrompt,
      }),
    };
  }
}
