/** The reader projection's row key, `insightId:userId`; no KSUID or user id holds a colon. */
export function insightReaderKey({
  insightId,
  userId,
}: {
  insightId: string;
  userId: string;
}): string {
  return `${insightId}:${userId}`;
}

export function parseInsightReaderKey(key: string): { insightId: string; userId: string } {
  const separator = key.indexOf(":");
  if (separator <= 0) throw new Error(`Not an insight reader key: ${key}`);
  return { insightId: key.slice(0, separator), userId: key.slice(separator + 1) };
}
