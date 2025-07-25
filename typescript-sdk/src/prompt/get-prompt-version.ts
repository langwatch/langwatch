import {
  canAutomaticallyCaptureInput,
  getApiKey,
  getEndpoint,
} from "../client";
import { PromptDefinition, GetPromptVersionResponse, GetPromptVersion } from "./types";
import { LangWatchApiError } from "../internal/api/errors";
import { formatPromptTemplate, formatPromptMessages } from "./formatting";
import { tracer } from "./tracer";
import * as intSemconv from "../observability/semconv";
import { Exception, SpanStatusCode } from "@opentelemetry/api";

/**
 * Fetches a specific version of a prompt definition from the LangWatch API by prompt ID and version number, optionally formatting it with provided variables.
 *
 * Starts an OpenTelemetry span for tracing, attaches relevant attributes, and records exceptions on error.
 *
 * @param {string} promptId - The unique identifier of the prompt to fetch.
 * @param {string} versionId - The version id of the prompt to fetch.
 * @param {Record<string, unknown>=} variables - Optional variables to interpolate into the prompt template and messages.
 * @returns {Promise<PromptDefinition>} Resolves with the fetched and formatted PromptDefinition object.
 * @throws {LangWatchApiError} If the API request fails or returns a non-OK response.
 */
export async function getPromptVersion(
  promptId: string,
  versionId: string,
  variables?: Record<string, unknown>,
): Promise<PromptDefinition> {
  return tracer.startActiveSpan("get prompt version", async (span) => {
    try {
      span.setType("prompt");
      span.setAttributes({
        [intSemconv.ATTR_LANGWATCH_PROMPT_ID]: promptId,
        [intSemconv.ATTR_LANGWATCH_PROMPT_VERSION_ID]: versionId,
      });

      if (canAutomaticallyCaptureInput()) {
        span.setAttribute(
          intSemconv.ATTR_LANGWATCH_PROMPT_VARIABLES,
          JSON.stringify({
            type: "json",
            value: variables,
          }),
        );
      }

      const url = new URL(`/api/prompts/${promptId}/versions`, getEndpoint());
      const response = await fetch(url.toString(), {
        headers: {
          "X-Auth-Token": getApiKey(),
        },
        method: "GET",
      });
      if (!response.ok) {
        const err = new LangWatchApiError("Failed to get prompt version", response);
        await err.safeParseBody(response);
        throw err;
      }

      const versions = (await response.json()) as GetPromptVersionResponse;
      let version: GetPromptVersion | undefined;

      for (const currentVersion of versions) {
        if (currentVersion.id === versionId) {
          version = currentVersion;
          break;
        }
      }

      if (!version) {
        throw new Error(`Prompt version:${versionId} not found for prompt:${promptId}`);
      }

      // Convert API response to PromptDefinition shape
      const prompt: PromptDefinition = {
        id: version.configId,
        name: version.configData.prompt, // No name in configData, so fallback to prompt string
        updatedAt: version.createdAt,
        version: version.version,
        versionId: version.id,
        versionCreatedAt: version.createdAt,
        model: version.configData.model,
        prompt: version.configData.prompt,
        messages: version.configData.messages,
        response_format: null,
      };

      if (variables) {
        prompt.messages = formatPromptMessages(prompt.messages, variables);
        prompt.prompt = formatPromptTemplate(prompt.prompt, variables);
      }

      span.setAttribute(
        intSemconv.ATTR_LANGWATCH_PROMPT_VERSION_NUMBER,
        prompt.version,
      );

      return prompt;
    } catch (err) {
      span.recordException(err as Exception);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error)?.message });

      throw err;
    } finally {
      span.end();
    }
  });
}
