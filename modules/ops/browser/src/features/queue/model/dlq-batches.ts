/** The explicit-id endpoints accept at most this many ids per call. */
export const MAX_GROUP_IDS_PER_CALL = 2000;

/**
 * Sends the ids in sequential batches the endpoint accepts and sums each
 * count, so one act covers every group the operator saw.
 */
export async function inBatches<T extends Record<string, number>>(
  input: { queueName: string; groupIds: string[] },
  send: (batch: { queueName: string; groupIds: string[] }) => Promise<T>,
): Promise<T> {
  const totals: Record<string, number> = {};
  for (let i = 0; i < input.groupIds.length; i += MAX_GROUP_IDS_PER_CALL) {
    const result = await send({
      queueName: input.queueName,
      groupIds: input.groupIds.slice(i, i + MAX_GROUP_IDS_PER_CALL),
    });
    for (const [key, value] of Object.entries(result)) {
      totals[key] = (totals[key] ?? 0) + value;
    }
  }
  return totals as T;
}
