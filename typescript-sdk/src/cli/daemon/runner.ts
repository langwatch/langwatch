/**
 * Executes one CLI command inside the daemon and reports its exit code.
 *
 * This is the piece that has to be indistinguishable from a fresh process:
 * same stdout bytes, same stderr bytes, same exit code.
 */

import { buildProgram } from "../program";
import {
  ExecutionContext,
  isDaemonExitSignal,
  withExecutionContext,
  type ExecutionWindow,
  type OutputSink,
} from "./execution";
import type { DaemonTelemetry } from "./telemetry";

export interface ExecuteRequest {
  requestId: string;
  /** User-level args (`process.argv.slice(2)` on the caller). */
  args: string[];
  cwd: string;
  env: Record<string, string>;
  colorLevel: number;
  sink: OutputSink;
}

export interface CommandExecution {
  /** Resolves with the command's exit code once it has finished. */
  completed: Promise<number>;
  /**
   * Abandon the command: stop emitting its output and settle at `code`.
   *
   * The underlying work cannot be killed — it is a promise chain inside this
   * process, and node has no way to unwind one from the outside. What we CAN
   * guarantee is what the caller observes: no further output, an immediate exit
   * code, and a released connection. The abandoned work finishes on its own
   * (it is a single HTTP call) and its output is discarded.
   */
  cancel(code: number): void;
}

export type CommandExecutor = (request: ExecuteRequest) => CommandExecution;

/**
 * Build the executor the daemon serves requests with.
 *
 * Injected into the server so tests can drive the socket, handshake, framing
 * and lifecycle without commander in the picture.
 */
export function createCommandExecutor({
  window,
  telemetry,
}: {
  window: ExecutionWindow;
  telemetry: DaemonTelemetry;
}): CommandExecutor {
  return (request: ExecuteRequest): CommandExecution => {
    const context = new ExecutionContext(request.requestId, (stream, chunk) => {
      request.sink(stream, chunk);
      telemetry.requestProgress({
        requestId: request.requestId,
        stream,
        bytes: chunk.byteLength,
      });
    });

    let cancelled = false;
    let settle: ((code: number) => void) | undefined;

    const completed = (async (): Promise<number> => {
      const startedAt = Date.now();

      // May reject when the caller's cwd no longer exists. The server turns
      // that into a `fallback` frame — no output has been emitted yet, so the
      // client can safely re-run the command itself.
      const release = await window.acquire({
        cwd: request.cwd,
        env: request.env,
        colorLevel: request.colorLevel,
      });

      telemetry.requestStarted({
        requestId: request.requestId,
        args: request.args,
        cwd: request.cwd,
      });

      let failure: unknown;
      try {
        // A fresh tree per request: commander mutates its Command objects with
        // the parsed option values, so a shared tree would leak options between
        // callers.
        const program = buildProgram();
        await withExecutionContext(context, () =>
          program.parseAsync(request.args, { from: "user" }),
        );
        context.finalize(0);
      } catch (error) {
        if (isDaemonExitSignal(error)) {
          // The command (or commander itself) called process.exit. The context
          // was finalised at the moment of the call, so its code already wins
          // and anything the unwinding stack printed was discarded.
          context.finalize(error.code);
        } else {
          failure = error;
          // An action that rejected without handling it. In a real process this
          // is an unhandled rejection: node prints the error and exits 1. We
          // print the same error and exit 1. (Node also prints its own internal
          // frames and a version banner; those we do not reproduce.)
          const stack =
            error instanceof Error
              ? (error.stack ?? `${error.name}: ${error.message}`)
              : String(error);
          context.write("stderr", Buffer.from(stack + "\n", "utf8"));
          context.finalize(1);
        }
      } finally {
        release();
      }

      telemetry.requestFinished({
        requestId: request.requestId,
        exitCode: context.exitCode,
        durationMs: Date.now() - startedAt,
        error: failure,
        cancelled,
      });

      return context.exitCode;
    })();

    // The promise the server awaits: whichever of "the command finished" or
    // "the client cancelled" happens first.
    const raced = new Promise<number>((resolve) => {
      settle = resolve;
      completed.then(
        (code) => resolve(code),
        () => resolve(context.exitCode),
      );
    });

    return {
      completed: raced,
      cancel: (code: number) => {
        if (context.isFinished) return;
        cancelled = true;
        // Finalising first is what actually enforces the cancellation: every
        // subsequent write from the abandoned command is dropped on the floor.
        context.finalize(code);
        settle?.(code);
      },
    };
  };
}
