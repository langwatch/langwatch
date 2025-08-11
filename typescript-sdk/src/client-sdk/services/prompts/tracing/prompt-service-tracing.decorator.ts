import { type PromptsService } from "../service";
import { type Prompt } from "../prompt";
import type { LangWatchSpan } from "@/observability-sdk";
import { shouldCaptureInput, shouldCaptureOutput } from "@/observability-sdk";
import type { CreatePromptBody, UpdatePromptBody } from "../types";

/**
 * Class that decorates the target prompt service,
 * adding tracing to key methods.
 */
export class PromptServiceTracingDecorator {
  constructor(private readonly target: PromptsService) {}

  async get(
    span: LangWatchSpan,
    id: string,
    options?: { version?: string }
  ): Promise<Prompt> {
    span.setType("prompt");
    span.setAttribute('langwatch.prompt.id', id);

    const result = await this.target.get(id, options);

    if (result) {
      span.setAttributes({
        'langwatch.prompt.id': result.id,
        'langwatch.prompt.handle': result.handle ?? '',
        'langwatch.prompt.version.id': result.versionId,
        'langwatch.prompt.version.number': result.version,
      });
    }

    if (result && shouldCaptureOutput()) {
      span.setOutput("json", result.raw);
    }

    return result;
  }

  async create(
    span: LangWatchSpan,
    params: CreatePromptBody
  ): Promise<Prompt> {
    span.setType("prompt");

    if (shouldCaptureInput()) {
      span.setInput(params);
    }

    const result = await this.target.create(params);

    span.setAttribute('langwatch.prompt.id', result.id);
    span.setAttribute('langwatch.prompt.handle', result.handle ?? '');
    span.setAttribute('langwatch.prompt.scope', result.scope);
    span.setAttribute('langwatch.prompt.version.id', result.versionId);
    span.setAttribute('langwatch.prompt.version.number', result.version);

    return result;
  }

  async update(
    span: LangWatchSpan,
    id: string,
    params: UpdatePromptBody
  ): Promise<Prompt> {

    if (shouldCaptureInput()) {
      span.setInput(params);
    }

    const result = await this.target.update(id, params);

    span.setType("prompt");
    span.setAttribute('langwatch.prompt.id', id);
    span.setAttribute('langwatch.prompt.handle', result.handle ?? '');
    span.setAttribute('langwatch.prompt.scope', result.scope);
    span.setAttribute('langwatch.prompt.version.id', result.versionId);
    span.setAttribute('langwatch.prompt.version.number', result.version);

    return result;
  }

  async delete(
    span: LangWatchSpan,
    id: string
  ): Promise<{ success: boolean }> {
    const result = await this.target.delete(id);

    span.setType("prompt");
    span.setAttribute('langwatch.prompt.id', id);
    span.setAttribute('langwatch.prompt.deleted', 'true');

    return result;
  }

  async upsert(
    span: LangWatchSpan,
    handle: string,
    config: any
  ): Promise<{ created: boolean; prompt: Prompt }> {
    if (shouldCaptureInput({ spanType: "prompt" })) {
      span.setInput(config);
    }

    const result = await this.target.upsert(handle, config);

    span.setType("prompt");
    span.setAttribute('langwatch.prompt.handle', handle);
    span.setAttribute('langwatch.prompt.created', result.created.toString());
    span.setAttribute('langwatch.prompt.id', result.prompt.id);
    span.setAttribute('langwatch.prompt.version.id', result.prompt.versionId);
    span.setAttribute('langwatch.prompt.version.number', result.prompt.version);

    return result;
  }

  async sync(
    span: LangWatchSpan,
    params: any
  ): Promise<any> {
    if (shouldCaptureInput()) {
      span.setInput(params);
    }

    const result = await this.target.sync(params);

    span.setType("prompt");
    span.setAttribute('langwatch.prompt.name', params.name);
    span.setAttribute('langwatch.prompt.sync.action', result.action);

    if (result.conflictInfo) {
      span.setAttribute('langwatch.prompt.sync.has_conflict', 'true');
      span.setAttribute('langwatch.prompt.sync.local_version', result.conflictInfo.localVersion.toString());
      span.setAttribute('langwatch.prompt.sync.remote_version', result.conflictInfo.remoteVersion.toString());
    }

    return result;
  }
}
