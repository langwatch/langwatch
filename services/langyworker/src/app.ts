/**
 * The worker application: config -> session -> ready, then the stdin command
 * loop. Commands are dispatched as they arrive (abort/ping are never queued
 * behind a running turn); turn commands chain through the runner, which
 * preempts a running turn per PROTOCOL.md.
 */

import { readFileSync } from "node:fs";
import { rawStdoutWrite } from "./boot.js";
import { loadConfig } from "./config.js";
import { PROTOCOL_VERSION, parseCommand } from "./protocol.js";
import { TurnRunner } from "./runner.js";
import { createLangySession } from "./session.js";
import { attachJsonlReader } from "./stdin.js";
import { composeSystemPrompt } from "./system-prompt.js";
import { createTurnContext } from "./tools/turn-context.js";
import { ProtocolWriter } from "./writer.js";

function warn(message: string): void {
  process.stderr.write(`langy-worker: ${message}\n`);
}

export async function runApp(): Promise<void> {
  const home = process.env.HOME;
  if (!home) {
    throw new Error("HOME is not set; the manager must provision a worker home");
  }

  const config = loadConfig(home);

  const agentsMdAtBoot = readFileSync(config.agentsFilePath, "utf8");
  const readAgentsMd = (): string => {
    try {
      return readFileSync(config.agentsFilePath, "utf8");
    } catch {
      return agentsMdAtBoot;
    }
  };
  const composeSystem = (turnSystem?: string): string =>
    composeSystemPrompt({
      personaPrompt: config.personaPrompt,
      agentsMd: readAgentsMd(),
      ...(turnSystem !== undefined ? { turnSystem } : {}),
    });

  const writer = new ProtocolWriter((chunk, callback) => rawStdoutWrite(chunk, callback));

  const systemPrompt = { current: composeSystem() };
  const turnContext = createTurnContext();
  const { session, resumed } = await createLangySession({
    config,
    home,
    systemPrompt,
    turnContext,
  });

  const runner = new TurnRunner({
    session,
    writer,
    composeSystem,
    applySystemPrompt: (composed) => {
      systemPrompt.current = composed;
    },
    warn,
    turnContext,
    // A resumed session already carries the conversation, so the handoff
    // digest a turn may still bring along would tell it its own story twice.
    sessionResumed: resumed,
  });
  session.subscribe(runner.onSessionEvent);

  await writer.emit({ type: "ready", protocol: PROTOCOL_VERSION, resumed });

  return new Promise<void>((resolve) => {
    attachJsonlReader({
      stream: process.stdin,
      onLine: (line) => {
        const command = parseCommand(line);
        if (!command) {
          // The line can carry an end-user prompt, so only its size is logged.
          warn(`ignoring unparseable stdin line of ${line.length} characters`);
          return;
        }
        switch (command.type) {
          case "ping":
            void writer.emit({ type: "pong" });
            break;
          case "turn":
            void runner.submitTurn(command).catch((error) => {
              warn(`turn crashed: ${error instanceof Error ? error.message : String(error)}`);
            });
            break;
          case "abort":
            runner.abortTurn(command.turnId);
            break;
          case "shutdown_imminent":
            runner.shutdownImminent();
            break;
        }
      },
      onEnd: () => {
        // Manager closed stdin: abort in-flight work (its aborted terminal
        // still lands), flush, exit.
        void (async () => {
          await runner.abortForExit();
          await writer.flush();
          resolve();
        })();
      },
    });
    process.stdin.resume();
  });
}
