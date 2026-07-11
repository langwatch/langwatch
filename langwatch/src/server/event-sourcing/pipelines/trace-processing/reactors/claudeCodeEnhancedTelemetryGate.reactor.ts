import { CLAUDE_CODE_TRACING_SCOPE } from "~/server/app-layer/traces/claude-code-log-events";
import type { ProjectService } from "~/server/app-layer/projects/project.service";

import { createLogger } from "../../../../../utils/logger/server";
import type { ReactorDefinition } from "../../../reactors/reactor.types";
import { isSpanReceivedEvent, type TraceProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:trace-processing:claude-code-enhanced-telemetry-gate-reactor",
);

export interface ClaudeCodeEnhancedTelemetryGateReactorDeps {
  projects: ProjectService;
}

/**
 * Per-project gate that retires Claude Code log-synthesis once the project
 * sends REAL tracing spans (plan §4.1 / C0).
 *
 * Claude Code's enhanced-telemetry beta emits real OTLP spans under scope
 * `com.anthropic.claude_code.tracing`. The moment a project sends one, keeping
 * the log-synthesis path on double-counts every model call (real span + a
 * synthesized `…events` span in a different trace). This reactor flips a
 * project flag on first sight of a tracing-scope span; downstream, log ingest
 * reads that flag and stops marking content logs for synthesis, which (a) makes
 * the synthesis fold find nothing to fold (double-count gone) and (b) reverts
 * content logs to normal project retention.
 *
 * The gate is per-PROJECT, not per-trace: the synthesized trace id and the real
 * trace id are different traces, so a per-trace check is impossible.
 *
 * Deduped per project (`makeJobId: cc-enhanced:${tenantId}`) so a hot trace's
 * hundreds of tracing spans coalesce into one flag write per window, and
 * idempotent (skips the write once the flag is already set). Best-effort:
 * a brand-new project may briefly double-count until this reactor flips the
 * flag — bounded and self-healing.
 */
export function createClaudeCodeEnhancedTelemetryGateReactor(
  deps: ClaudeCodeEnhancedTelemetryGateReactorDeps,
): ReactorDefinition<TraceProcessingEvent> {
  return {
    name: "claudeCodeEnhancedTelemetryGate",
    // Pure, sync pre-enqueue guard — only real Claude Code tracing spans get a
    // job. Everything else (every other span in the system) is filtered here,
    // before any queue work, so the reactor is free on the non-claude hot path.
    shouldReact: (event) =>
      isSpanReceivedEvent(event) &&
      event.data.instrumentationScope?.name === CLAUDE_CODE_TRACING_SCOPE,
    options: {
      runIn: ["worker"],
      makeJobId: (payload) => `cc-enhanced:${payload.event.tenantId}`,
      // The flag is terminal, so a long dedup window keeps a busy project from
      // re-reading/re-writing it on every export batch.
      ttl: 5 * 60_000,
    },

    async handle(event: TraceProcessingEvent): Promise<void> {
      // Re-check in handle: shouldReact filters the enqueue, but the payload is
      // captured at dispatch and handlers run best-effort — never flip the gate
      // off a non-tracing span.
      if (!isSpanReceivedEvent(event)) return;
      if (event.data.instrumentationScope?.name !== CLAUDE_CODE_TRACING_SCOPE) {
        return;
      }

      const tenantId = event.tenantId;

      try {
        // Already gated — nothing to do (avoids a redundant write).
        if (await deps.projects.hasClaudeCodeEnhancedTelemetry(tenantId)) {
          return;
        }

        await deps.projects.enableClaudeCodeEnhancedTelemetry(tenantId);

        logger.info(
          { tenantId },
          "Enabled Claude Code enhanced telemetry — real tracing spans seen, log-synthesis retired for this project",
        );
      } catch (error) {
        logger.error(
          {
            tenantId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to enable Claude Code enhanced telemetry — non-fatal",
        );
      }
    },
  };
}
