import {
  MigrationEnrollmentAlreadyExistsError,
  MigrationEnrollmentNotFoundError,
  MigrationEnrollmentOrganizationNotFoundError,
} from "@langwatch/ops-contract";
import { nowInstant, toDate } from "@langwatch/time";

import type { MigrationEnrollmentRecord } from "../../services/system-migrations.service.ts";
import type { SystemMigrationEnrollmentRepository } from "../system-migration-enrollment.repository.ts";

/**
 * Enrollments in one process's memory. The organization table is not ops' to hold, so this tier
 * knows no organization: lookups refuse, counts are zero and the eligible pool is empty.
 */
export class MemorySystemMigrationEnrollmentRepository implements SystemMigrationEnrollmentRepository {
  readonly #enrollments: MigrationEnrollmentRecord[] = [];

  static create(): MemorySystemMigrationEnrollmentRepository {
    return new MemorySystemMigrationEnrollmentRepository();
  }

  private constructor() {}

  async findAll(): Promise<MigrationEnrollmentRecord[]> {
    return this.#enrollments.toSorted(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    );
  }

  async findEnrolledOrganizationIdsByMigration(): Promise<Map<string, Set<string>>> {
    const byMigration = new Map<string, Set<string>>();
    for (const enrollment of this.#enrollments) {
      const ids = byMigration.get(enrollment.migrationName) ?? new Set<string>();
      ids.add(enrollment.organizationId);
      byMigration.set(enrollment.migrationName, ids);
    }
    return byMigration;
  }

  async isEnrolled({
    organizationId,
    migrationName,
  }: {
    organizationId: string;
    migrationName: string;
  }): Promise<boolean> {
    return this.#indexOf({ organizationId, migrationName }) >= 0;
  }

  async countEnrolledByMigration(): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const enrollment of this.#enrollments) {
      counts.set(enrollment.migrationName, (counts.get(enrollment.migrationName) ?? 0) + 1);
    }
    return counts;
  }

  async countOrganizations(): Promise<number> {
    return 0;
  }

  async getOrganizationById(_input: {
    organizationId: string;
  }): Promise<{ id: string; name: string }> {
    throw new MigrationEnrollmentOrganizationNotFoundError();
  }

  async searchOrganizations(_input: { query: string }): Promise<{ id: string; name: string }[]> {
    return [];
  }

  async findCohortEligibleOrganizations(_input: {
    migrationName: string;
    enrolledForMigrationName?: string;
    excludeOrganizationIds: string[];
    includeEnterprise?: boolean;
  }): Promise<{ id: string; name: string }[]> {
    return [];
  }

  async createMany({
    organizationIds,
    migrationName,
    enrolledByUserId,
  }: {
    organizationIds: string[];
    migrationName: string;
    enrolledByUserId: string;
  }): Promise<{ insertedCount: number }> {
    let insertedCount = 0;
    for (const organizationId of organizationIds) {
      if (this.#indexOf({ organizationId, migrationName }) >= 0) continue;
      this.#append({ organizationId, migrationName, enrolledByUserId });
      insertedCount += 1;
    }
    return { insertedCount };
  }

  async create({
    organizationId,
    migrationName,
    enrolledByUserId,
  }: {
    organizationId: string;
    migrationName: string;
    enrolledByUserId: string;
  }): Promise<void> {
    if (this.#indexOf({ organizationId, migrationName }) >= 0) {
      throw new MigrationEnrollmentAlreadyExistsError({ migrationName });
    }
    this.#append({ organizationId, migrationName, enrolledByUserId });
  }

  async delete({
    organizationId,
    migrationName,
  }: {
    organizationId: string;
    migrationName: string;
  }): Promise<void> {
    const index = this.#indexOf({ organizationId, migrationName });
    if (index < 0) throw new MigrationEnrollmentNotFoundError({ migrationName });
    this.#enrollments.splice(index, 1);
  }

  #indexOf({
    organizationId,
    migrationName,
  }: {
    organizationId: string;
    migrationName: string;
  }): number {
    return this.#enrollments.findIndex(
      (enrollment) =>
        enrollment.organizationId === organizationId && enrollment.migrationName === migrationName,
    );
  }

  #append({
    organizationId,
    migrationName,
    enrolledByUserId,
  }: {
    organizationId: string;
    migrationName: string;
    enrolledByUserId: string;
  }): void {
    this.#enrollments.push({
      organizationId,
      organizationName: null,
      migrationName,
      enrolledByUserId,
      enrolledByLabel: null,
      createdAt: toDate(nowInstant()),
    });
  }
}
