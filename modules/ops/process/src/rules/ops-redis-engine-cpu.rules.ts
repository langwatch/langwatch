/**
 * Redis engine-CPU percent derivation. Redis runs commands on a single
 * thread; CloudWatch's `EngineCPUUtilization` is that thread's user+sys CPU
 * percent, derived here by diffing two `INFO cpu` snapshots.
 */

export type RedisCpuSample = {
  userSec: number;
  sysSec: number;
  sampledAt: number;
};

/** Engine-CPU percent (0-100); null on first sample, counter backslide, or same timestamp. */
export function computeEngineCpuPercent(args: {
  prev: RedisCpuSample | null;
  nextUserSec: number;
  nextSysSec: number;
  nextSampledAt: number;
}): number | null {
  const { prev, nextUserSec, nextSysSec, nextSampledAt } = args;
  if (prev === null) return null;
  const elapsedMs = nextSampledAt - prev.sampledAt;
  if (elapsedMs <= 0) return null;
  const deltaCpuSec = nextUserSec - prev.userSec + (nextSysSec - prev.sysSec);
  // Counter rewind = Redis restarted. Drop this sample to avoid surfacing a
  // huge negative percent; the next cycle will have a fresh baseline.
  if (deltaCpuSec < 0) return null;
  const percent = (deltaCpuSec / (elapsedMs / 1000)) * 100;
  return Math.round(percent * 10) / 10;
}
