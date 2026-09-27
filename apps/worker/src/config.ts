import { readVoiceWorkerEnv, type VoiceWorkerEnv } from "@langwatch/scenario-contract";

/** The worker's voice environment: its media port, public origin and tunnel toggle. */
export function readWorkerVoiceEnvironment(): Readonly<{
  voice: VoiceWorkerEnv;
  environment: NodeJS.ProcessEnv;
}> {
  return { voice: readVoiceWorkerEnv(process.env), environment: process.env };
}

/** The environment this process was started with, handed to the preamble. */
export const processEnvironment: Readonly<Record<string, string | undefined>> = process.env;
