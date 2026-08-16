/**
 * How long ago something happened, for the personal pages.
 *
 * The ladder gets coarser as the gap widens, because that is the precision a
 * reader can use: seconds matter for a device that just checked in, days do
 * not. Past a month the relative form stops meaning anything, so it hands over
 * to the date itself.
 *
 * Absence is a real answer here rather than a missing value: a key that was
 * issued and never used says "Never", which is the fact the reader wants.
 */
export function formatRelativeTime(ms: number | null | undefined): string {
  if (!ms) return "Never";

  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 60) return `${sec}s ago`;

  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;

  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;

  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;

  return new Date(ms).toLocaleDateString();
}
