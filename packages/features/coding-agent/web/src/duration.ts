/**
 * A stretch of working time, read the way a person says it out loud: "45s",
 * "12m", "3h 20m". Coding-agent sessions run for hours, so the hour is the
 * largest unit worth naming and the seconds stop mattering above a minute.
 */
export function formatDurationSeconds(totalSeconds: number): string {
  const seconds = Math.round(totalSeconds);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}
