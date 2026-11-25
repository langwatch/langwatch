// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { z } from "zod";

const organizationIdSchema = z.string().trim().min(1);

/** Prisma omits undefined predicates, so validate scope before building queries. */
export function assertScimOrganizationId(organizationId: string): void {
  organizationIdSchema.parse(organizationId);
}
