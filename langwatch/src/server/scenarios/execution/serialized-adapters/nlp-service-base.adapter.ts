/**
 * Base class for NLP service adapters that execute workflows via
 * the /studio/execute_sync endpoint.
 *
 * Encapsulates the shared execution protocol (fetch with timeout,
 * error handling, output extraction) so subclasses only implement
 * workflow payload construction.
 */

import type { AgentInput } from "@langwatch/scenario";
import { AgentAdapter, AgentRole } from "@langwatch/scenario";
import { randomBytes } from "crypto";

/** Timeout for NLP service requests (2 minutes) */
const NLP_FETCH_TIMEOUT_MS = 120_000;

/** Fields describing an input or output slot */
export interface FieldDef {
  identifier: string;
  type: string;
}

/**
 * Abstract base for adapters that execute workflows on the NLP service.
 *
 * Subclasses must implement:
 * - `buildWorkflowPayload()` to produce the workflow object sent to the NLP service
 * - `getInputFields()` to return the entry-node input field definitions
 * - `getOutputFields()` to return the end-node output field definitions
 * - `getErrorLabel()` to return a human-readable label for error messages
 */
export abstract class NlpServiceBaseAdapter extends AgentAdapter {
  role = AgentRole.AGENT;

  constructor(
    protected readonly nlpServiceUrl: string,
    protected readonly apiKey: string,
  ) {
    super();
  }

  /** Build the workflow object sent in the execute_flow payload. */
  protected abstract buildWorkflowPayload(): Record<string, unknown>;

  /** Return the input field definitions (from entry node or config). */
  protected abstract getInputFields(): FieldDef[];

  /** Return the output field definitions (from end node or config). */
  protected abstract getOutputFields(): FieldDef[];

  /** Human-readable label used in error messages (e.g. "Workflow", "Code"). */
  protected abstract getErrorLabel(): string;

  async call(input: AgentInput): Promise<string> {
    const lastUserMessage = input.messages.findLast((m) => m.role === "user");
    const content = lastUserMessage?.content;
    const inputValue =
      typeof content === "string"
        ? content
        : content == null
          ? ""
          : JSON.stringify(content);

    const inputRecord = this.buildInputRecord(inputValue);
    const workflow = this.buildWorkflowPayload();
    const result = await this.executeOnNlpService(workflow, inputRecord);
    return result;
  }

  /**
   * Build input values record for the execute_flow event.
   * Only the first input receives the scenario message; others get empty strings.
   */
  protected buildInputRecord(inputValue: string): Record<string, string> {
    const fields = this.getInputFields();
    const inputs =
      fields.length > 0
        ? fields
        : [{ identifier: "input", type: "str" }];

    const record: Record<string, string> = {};
    for (let i = 0; i < inputs.length; i++) {
      record[inputs[i]!.identifier] = i === 0 ? inputValue : "";
    }
    return record;
  }

  /**
   * Execute the workflow via the NLP service's /studio/execute_sync endpoint.
   */
  protected async executeOnNlpService(
    workflow: Record<string, unknown>,
    inputRecord: Record<string, string>,
  ): Promise<string> {
    const event = {
      type: "execute_flow" as const,
      payload: {
        trace_id: randomBytes(16).toString("hex"),
        workflow,
        inputs: [inputRecord],
        manual_execution_mode: false,
        do_not_trace: true,
        run_evaluations: false,
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      NLP_FETCH_TIMEOUT_MS,
    );

    try {
      let response: Response;
      try {
        response = await fetch(
          `${this.nlpServiceUrl}/studio/execute_sync`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(event),
            signal: controller.signal,
          },
        );
      } catch (fetchError) {
        const cause =
          fetchError instanceof Error && "cause" in fetchError
            ? ` (cause: ${String((fetchError as Error & { cause?: unknown }).cause)})`
            : "";
        throw new Error(
          `${this.getErrorLabel()} execution failed: fetch to ${this.nlpServiceUrl}/studio/execute_sync failed - ${fetchError instanceof Error ? fetchError.message : String(fetchError)}${cause}`,
        );
      }

      if (!response.ok) {
        let errorMessage = "";
        try {
          const errorBody = (await response.json()) as { detail?: string };
          errorMessage = errorBody.detail ?? JSON.stringify(errorBody);
        } catch {
          errorMessage = await response.text().catch(() => "");
        }
        throw new Error(
          `${this.getErrorLabel()} execution failed: HTTP ${response.status}${errorMessage ? ` - ${errorMessage}` : ""}`,
        );
      }

      const result = (await response.json()) as {
        trace_id: string;
        status: string;
        result: Record<string, unknown> | null;
      };
      return this.extractOutput(result.result);
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Extract the output string from the NLP service response.
   *
   * The result is the output from the "end" node, which is a dict
   * of output identifier -> value.
   */
  protected extractOutput(result: Record<string, unknown> | null): string {
    if (!result) return "";
    if (typeof result === "string") return result;

    const fields = this.getOutputFields();
    const firstOutputId = fields[0]?.identifier ?? "output";
    const value = result[firstOutputId];
    if (value !== undefined) return this.stringify(value);

    // Fallback: return first available value
    const firstValue = Object.values(result)[0];
    if (firstValue !== undefined) return this.stringify(firstValue);

    // Last resort: stringify the whole result
    return this.stringify(result);
  }

  protected stringify(value: unknown): string {
    return typeof value === "string" ? value : JSON.stringify(value);
  }
}
