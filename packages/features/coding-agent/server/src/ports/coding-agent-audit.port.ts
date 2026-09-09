/**
 * Where a read that names people is written down. The deployment owns the
 * ledger; what one of this feature's reads is worth recording is the
 * application's, so the entry is built there and only the writing arrives here.
 */
export abstract class CodingAgentAuditPort {
  abstract auditLog(entry: {
    userId: string;
    organizationId: string;
    action: string;
    targetKind: string;
    targetId: string;
    args: Record<string, unknown>;
  }): Promise<void>;
}
