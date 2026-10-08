// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { NON_DESTINATION_PROJECT_KINDS } from "@langwatch/project-contract";

import { BillingProjectDirectoryRepository } from "../billing-project-directory.repository.ts";
import type { MemoryBillingStore } from "./memory.billing.store.ts";

/** The Prisma read's twin over the store's project rows. */
export class MemoryBillingProjectDirectoryRepository extends BillingProjectDirectoryRepository {
  private constructor(private readonly store: MemoryBillingStore) {
    super();
  }

  static create(store: MemoryBillingStore): MemoryBillingProjectDirectoryRepository {
    return new MemoryBillingProjectDirectoryRepository(store);
  }

  async findProjectIds({ organizationId }: { organizationId: string }): Promise<string[]> {
    return this.store.projects
      .filter((project) => project.organizationId === organizationId && !project.archived)
      .map((project) => project.id);
  }

  async findProjectsWithName({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ id: string; name: string }[]> {
    return this.store.projects
      .filter(
        (project) =>
          project.organizationId === organizationId &&
          !NON_DESTINATION_PROJECT_KINDS.includes(project.kind),
      )
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map(({ id, name }) => ({ id, name }));
  }
}
