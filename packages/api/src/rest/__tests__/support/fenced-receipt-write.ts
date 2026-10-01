/** A fenced receipt write, read back from its bound values in the order the SQL names them. */
export type FencedReceiptWrite = {
  id: unknown;
  claimId: unknown;
  pendingOnly: boolean;
  data: Record<string, unknown>;
};

export function readFencedReceiptWrite(
  sql: TemplateStringsArray,
  values: unknown[],
): FencedReceiptWrite {
  const text = sql.join("?");

  if (text.includes('SET "claimId"')) {
    const [claimId, heartbeatAt, expiresAt, id, fence] = values;
    return { id, claimId: fence, pendingOnly: true, data: { claimId, heartbeatAt, expiresAt } };
  }

  if (text.includes('"responseStatus" =')) {
    const [responseStatus, responseBody, id, fence] = values;
    return { id, claimId: fence, pendingOnly: false, data: { responseStatus, responseBody } };
  }

  const [heartbeatAt, id, fence] = values;
  return { id, claimId: fence, pendingOnly: false, data: { heartbeatAt } };
}
