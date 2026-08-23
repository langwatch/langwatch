export const LATENCY_SAMPLE_SIZE = 200;
export const LATENCY_MINUTE_BUCKET_TTL_SECONDS = 2 * 60 * 60;
export const LATENCY_HOUR_BUCKET_TTL_SECONDS = 8 * 24 * 60 * 60;

export function latencyBucketField(durationMs: number): string {
  for (let power = 1; power <= 524_288; power *= 2) {
    if (durationMs <= power) return String(power);
    if (durationMs <= power * 1.5) return String(power * 1.5);
  }
  return "+Inf";
}

export function latencyMinuteBucketKey(
  queueName: string,
  nowMs: number,
): string {
  return `${queueName}:gq:stats:lat-hist:m:${Math.floor(nowMs / 60_000)}`;
}

export function latencyHourBucketKey(queueName: string, nowMs: number): string {
  return `${queueName}:gq:stats:lat-hist:h:${Math.floor(nowMs / 3_600_000)}`;
}

export function latencyAllTimeKey(queueName: string): string {
  return `${queueName}:gq:stats:lat-hist:all`;
}
