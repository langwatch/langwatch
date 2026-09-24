import type { Department } from "@langwatch/enterprise-governance-contract";

/** Departments only: who sits in one is organization's and project's to say (their Api ops). */
export abstract class DepartmentRepository {
  abstract findAll(organizationId: string): Promise<Department[]>;
  abstract findById(input: { id: string; organizationId: string }): Promise<Department | null>;
  abstract create(input: { organizationId: string; name: string }): Promise<Department>;
  abstract resolveByNameOrCreate(input: {
    organizationId: string;
    name: string;
  }): Promise<Department>;
  abstract rename(input: { id: string; organizationId: string; name: string }): Promise<boolean>;
  abstract archive(input: { id: string; organizationId: string }): Promise<boolean>;
}
