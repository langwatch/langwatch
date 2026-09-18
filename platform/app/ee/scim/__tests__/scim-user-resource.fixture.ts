// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { vi } from "vitest";

import type { ScimUserResource } from "~/generated/prisma/client";

type ResourceWrite = Pick<
  ScimUserResource,
  "organizationId" | "userId" | "userName" | "name" | "active"
> & { deletedAt?: Date | null };

export function resourceStore() {
  const rows = new Map<string, ScimUserResource>();
  return {
    findUnique: vi.fn(
      async ({
        where,
      }: {
        where: {
          organizationId_userId: { organizationId: string; userId: string };
        };
      }) => {
        const key = where.organizationId_userId;
        return rows.get(`${key.organizationId}/${key.userId}`) ?? null;
      },
    ),
    findFirst: vi.fn().mockResolvedValue(null),
    upsert: vi.fn(
      async ({
        create,
        update,
      }: {
        create: ResourceWrite;
        update: Partial<ResourceWrite>;
      }) => {
        const key = `${create.organizationId}/${create.userId}`;
        const existing = rows.get(key);
        const row = existing
          ? { ...existing, ...update, updatedAt: new Date() }
          : {
              ...create,
              deletedAt: create.deletedAt ?? null,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
        rows.set(key, row);
        return row;
      },
    ),
    deleteMany: vi.fn(
      async ({
        where,
      }: {
        where: { organizationId: string; userId: string };
      }) => ({
        count: Number(rows.delete(`${where.organizationId}/${where.userId}`)),
      }),
    ),
  };
}
