import {
  canAutomaticallyCaptureInput,
  getApiKey,
  getEndpoint,
} from "../client";
import { PromptDefinition } from "./types";
import { LangWatchApiError } from "../internal/api/errors";
import { formatPromptTemplate, formatPromptMessages } from "./formatting";
import { tracer } from "./tracer";
import * as intSemconv from "../observability/semconv";
import { Exception, SpanStatusCode } from "@opentelemetry/api";

/**
 * Fetches a prompt definition from the LangWatch API by prompt ID, optionally formatting it with provided variables.
 *
 * Starts an OpenTelemetry span for tracing, attaches relevant attributes, and records exceptions on error.
 *
 * @param {string} promptId - The unique identifier of the prompt to fetch.
 * @param {Record<string, unknown>=} variables - Optional variables to interpolate into the prompt template and messages.
 * @returns {Promise<PromptDefinition>} Resolves with the fetched and formatted PromptDefinition object.
 * @throws {LangWatchApiError} If the API request fails or returns a non-OK response.
 */
export async function getPrompt(
  promptId: string,
  variables?: Record<string, unknown>,
): Promise<PromptDefinition> {
  return tracer.startActiveSpan("get prompt", async (span) => {
    try {
      span.setType("prompt");
      span.setAttribute(intSemconv.ATTR_LANGWATCH_PROMPT_ID, promptId);

      if (canAutomaticallyCaptureInput()) {
        span.setAttribute(
          intSemconv.ATTR_LANGWATCH_PROMPT_VARIABLES,
          JSON.stringify({
            type: "json",
            value: variables,
          }),
        );
      }

      const url = new URL(`/api/prompts/${promptId}`, getEndpoint());
      const response = await fetch(url.toString(), {
        headers: {
          "X-Auth-Token": getApiKey(),
        },
        method: "GET",
      });
      if (!response.ok) {
        const err = new LangWatchApiError("Failed to get prompt", response);
        await err.safeParseBody(response);

        throw err;
      }

      const prompt = (await response.json()) as PromptDefinition;

      if (variables) {
        prompt.messages = formatPromptMessages(prompt.messages, variables);
        prompt.prompt = formatPromptTemplate(prompt.prompt, variables);
      }

      span.setAttributes({
        [intSemconv.ATTR_LANGWATCH_PROMPT_VERSION_NUMBER]: prompt.version,
        [intSemconv.ATTR_LANGWATCH_PROMPT_VERSION_ID]: prompt.versionId,
      });

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
