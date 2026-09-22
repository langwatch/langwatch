import type { Event } from "../../domain/types";
import { definePipeline } from "../../pipeline/staticBuilder";
import {
  CLI_LOGIN_KEY_REAP_INTERVAL_MS,
  CLI_LOGIN_KEY_REAP_PROCESS_NAME,
  type CliLoginKeyReapDeps,
  type CliLoginKeyReapState,
  cliLoginKeyReapSchema,
  cliLoginKeyReapWake,
  runCliLoginKeyReap,
} from "./process-manager/cliLoginKeyReap.process";

export interface CliLoginKeyMaintenancePipelineDeps {
  loginKeyReap: CliLoginKeyReapDeps;
}

/**
 * Credential maintenance for CLI device sessions, in its own pipeline for the
 * same reason the sandbox and Langy sweeps are in theirs: retiring the keys a
 * session left behind belongs to neither the session nor the queue.
 *
 * A session the CLI stops refreshing leaves Redis by TTL, which runs no code,
 * so this sweep is the only thing that retires its login key and the ingest
 * keys under it.
 *
 * The pipeline carries no events and no commands. A process manager with no
 * event handlers registers no subscriber, so this costs nothing beyond the
 * scheduled wake it exists for.
 */
export function createCliLoginKeyMaintenancePipeline(
  deps: CliLoginKeyMaintenancePipelineDeps,
) {
  return (
    definePipeline<Event>()
      .withName("cli_login_key_maintenance")
      // `global`, like the other maintenance pipelines: this one appends no
      // events, and the sweep spans every tenant by design.
      .withAggregateType("global")
      .withProcessManager(CLI_LOGIN_KEY_REAP_PROCESS_NAME, (pm) =>
        pm
          .state<CliLoginKeyReapState>({ lastReapAt: null })
          .schedule({ everyMs: CLI_LOGIN_KEY_REAP_INTERVAL_MS })
          .onWake(cliLoginKeyReapWake)
          .intent(
            "reap",
            cliLoginKeyReapSchema,
            runCliLoginKeyReap(deps.loginKeyReap),
          )
          // One bounded read, then a revoke per elapsed key with its cascade.
          // Sessions run out a few at a time, so the default-ish lease holds.
          .outbox({ leaseDurationMs: 5 * 60 * 1000, maxAttempts: 3 }),
      )
      .build()
  );
}
