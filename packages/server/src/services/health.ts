import { setTimeout as sleep } from "node:timers/promises";
import { execa } from "execa";

export type HealthProbeOk = { ok: true; durationMs: number };
export type HealthProbeFail = { ok: false; durationMs: number; reason: string };
export type HealthProbeResult = HealthProbeOk | HealthProbeFail;

export type HealthCheck = () => Promise<HealthProbeResult>;

/**
 * Poll a health check until it succeeds or the timeout elapses. Returns the
 * total wall-clock time spent waiting so the caller can emit a "healthy"
 * event with the right duration.
 */
export async function pollUntilHealthy({
  check,
  timeoutMs,
  intervalMs = 500,
}: {
  check: HealthCheck;
  timeoutMs: number;
  intervalMs?: number;
}): Promise<HealthProbeResult> {
  const start = Date.now();
  let lastReason = "no probe attempted";
  while (Date.now() - start < timeoutMs) {
    const result = await check();
    if (result.ok) return { ok: true, durationMs: Date.now() - start };
    lastReason = result.reason;
    await sleep(intervalMs);
  }
  return { ok: false, durationMs: Date.now() - start, reason: `timed out: ${lastReason}` };
}

export function httpGetCheck(url: string, opts: { expectStatus?: number; expectBodyContains?: string } = {}): HealthCheck {
  return async () => {
    const start = Date.now();
    try {
      const res = await fetch(url);
      const status = res.status;
      const expected = opts.expectStatus ?? 200;
      if (status !== expected) {
        return { ok: false, durationMs: Date.now() - start, reason: `status ${status} (expected ${expected})` };
      }
      if (opts.expectBodyContains) {
        const body = await res.text();
        if (!body.includes(opts.expectBodyContains)) {
          return {
            ok: false,
            durationMs: Date.now() - start,
            reason: `body missing "${opts.expectBodyContains}"`,
          };
        }
      }
      return { ok: true, durationMs: Date.now() - start };
    } catch (err) {
      return { ok: false, durationMs: Date.now() - start, reason: (err as Error).message };
    }
  };
}

export function execCheck(command: string, args: string[], opts: { expectStdoutContains?: string } = {}): HealthCheck {
  return async () => {
    const start = Date.now();
    try {
      const { exitCode, stdout } = await execa(command, args, { reject: false });
      if (exitCode !== 0) {
        return { ok: false, durationMs: Date.now() - start, reason: `exit ${exitCode}` };
      }
      if (opts.expectStdoutContains && !stdout.includes(opts.expectStdoutContains)) {
        return {
          ok: false,
          durationMs: Date.now() - start,
          reason: `stdout missing "${opts.expectStdoutContains}"`,
        };
      }
      return { ok: true, durationMs: Date.now() - start };
    } catch (err) {
      return { ok: false, durationMs: Date.now() - start, reason: (err as Error).message };
    }
  };
}
