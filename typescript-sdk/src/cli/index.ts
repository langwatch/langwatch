#!/usr/bin/env node

// Load environment variables BEFORE any other imports
import { config } from "dotenv";
// quiet: silence dotenv's "injecting env" tip line on every CLI run.
config({ quiet: true });

import { runCli } from "./daemon/dispatch";

/**
 * The entrypoint is deliberately almost empty.
 *
 * The command tree lives in `./program.ts` and is loaded lazily, because an
 * invocation that a warm daemon can serve should never pay for commander, the
 * client SDK, or any command module — that graph is most of the cold start.
 *
 * `runCli` falls back to building and parsing the program in-process whenever a
 * daemon is unavailable, disabled, or unsuitable for this command, which is the
 * default and is byte-for-byte what the CLI did before daemon mode existed.
 */
void runCli(process.argv);
