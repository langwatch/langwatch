// Smoke-test v3 — DO NOT MERGE. Soft-delete instead of archive (soft-delete-vs-archive.md).
// House pattern is archivedAt, not deletedAt.

export type SoftDeletedResource = {
  id: string;
  name: string;
  deletedAt: Date | null;  // VIOLATION — should be archivedAt.
};

export async function softDelete(id: string): Promise<void> {
  // Simulated repository call writing deletedAt.
  await fakePrisma.resource.update({
    where: { id },
    data: { deletedAt: new Date() },  // VIOLATION.
  });
}

declare const fakePrisma: { resource: { update: (args: unknown) => Promise<unknown> } };
