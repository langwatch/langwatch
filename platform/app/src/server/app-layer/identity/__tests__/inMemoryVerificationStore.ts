import type {
  IdentityVerificationRecord,
  IdentityVerificationStore,
} from "../verification-ceremony";

/** In-memory mirror of the Prisma repository's replace/find/consume shape. */
export class InMemoryVerificationStore implements IdentityVerificationStore {
  records = new Map<string, IdentityVerificationRecord>();

  async replaceForIdentifier(record: IdentityVerificationRecord) {
    this.records.set(record.identifierId, record);
  }

  async findByIdentifierId({ identifierId }: { identifierId: string }) {
    return this.records.get(identifierId) ?? null;
  }

  async consume({
    identifierId,
    verificationId,
  }: {
    identifierId: string;
    verificationId: string;
  }) {
    const record = this.records.get(identifierId);
    if (!record || record.verificationId !== verificationId) return false;
    this.records.delete(identifierId);
    return true;
  }
}
