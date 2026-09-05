/**
 * How the global setup tells the test workers which stack it resolved.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

export type StackHandoff = Readonly<{
  baseUrl: string;
  apiKey: string;
  organizationApiKey: string;
  projectId: string;
}>;

export const STACK_HANDOFF_FILE = resolve(tmpdir(), "langwatch-sdk-e2e-stack.json");

export function writeStackHandoff(handoff: StackHandoff): void {
  writeFileSync(STACK_HANDOFF_FILE, JSON.stringify(handoff, null, 2), { mode: 0o600 });
}

export function readStackHandoff(): StackHandoff | null {
  if (!existsSync(STACK_HANDOFF_FILE)) return null;
  return JSON.parse(readFileSync(STACK_HANDOFF_FILE, "utf8")) as StackHandoff;
}
