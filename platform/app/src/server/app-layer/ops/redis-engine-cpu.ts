/**
 * Redis engine-CPU percent derivation.
 *
 * Redis processes commands on a single thread. CloudWatch's
 * `EngineCPUUtilization` is the percent of that thread spent in user+sys CPU
 * time. We derive the same number locally by diffing two `INFO cpu` snapshots
 * of `used_cpu_user_main_thread` and `used_cpu_sys_main_thread`.
 */

export type RedisCpuSample = {
  userSec: number;
  sysSec: number;
  sampledAt: number;
};

/**
 * Returns the engine-CPU percent (0-100, rounded to one decimal) given a
 * previous sample and a fresh reading. Returns null when:
 *   - there is no previous sample yet (first collection cycle), OR
 *   - the cumulative counter went backwards (Redis restarted between samples), OR
 *   - the two samples were taken at the same instant (would divide by zero).
 *
 * The caller is responsible for storing the latest sample so the next call can
 * compare against it.
 */
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
