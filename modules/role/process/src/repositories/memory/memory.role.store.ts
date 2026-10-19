import { roleSchema, type Role } from "@langwatch/role-contract";

/**
 * The rows the grants ledger would have produced. A definition is written
 * through the ledger, so a test states rows here and the repository reads them.
 */
export class MemoryRoleStore {
  readonly roles = new Map<string, Role>();
  readonly assignments: { userId: string; teamId: string; customRoleId: string }[] = [];

  private constructor() {}

  static create(): MemoryRoleStore {
    return new MemoryRoleStore();
  }

  /** States one stored role, parsed by the same schema Prisma rows return through. */
  save(role: Role): Role {
    const stored = roleSchema.parse(role);
    this.roles.set(stored.id, stored);

    return stored;
  }

  /** States one legacy team assignment of a custom role. */
  assign(assignment: { userId: string; teamId: string; customRoleId: string }): void {
    this.assignments.push(assignment);
  }

  /** Forgets one stored role, as the ledger's delete would. */
  forget(input: { roleId: string }): void {
    this.roles.delete(input.roleId);
  }
}
