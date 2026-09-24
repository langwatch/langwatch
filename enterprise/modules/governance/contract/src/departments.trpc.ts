// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Every `departments.*` procedure, declared once, at main's wire names. */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { departmentAssignmentsSchema, departmentSchema } from "./department.ts";
import { governanceWriteAcknowledgedSchema } from "./governance.responses.ts";

const organizationScope = z.object({ organizationId: z.string() });
const departmentName = z.string().min(1).max(128);
const departmentInOrganization = z.object({ ...organizationScope.shape, id: z.string() });

export const departmentsTrpc = defineTrpcContract("departments")
  .query("list")
  .withInput(organizationScope)
  .withOutput(departmentSchema.array())

  .query("assignments")
  .withInput(organizationScope)
  .withOutput(departmentAssignmentsSchema)

  .mutation("create")
  .withInput(z.object({ ...organizationScope.shape, name: departmentName }))
  .withOutput(departmentSchema)

  .mutation("rename")
  .withInput(z.object({ ...departmentInOrganization.shape, name: departmentName }))
  .withOutput(departmentSchema)

  .mutation("archive")
  .withInput(departmentInOrganization)
  .withOutput(governanceWriteAcknowledgedSchema)

  .mutation("assignUser")
  .withInput(
    z.object({
      ...organizationScope.shape,
      userId: z.string(),
      departmentId: z.string().nullable(),
    }),
  )
  .withOutput(governanceWriteAcknowledgedSchema)

  .mutation("assignTeam")
  .withInput(
    z.object({
      ...organizationScope.shape,
      teamId: z.string(),
      departmentId: z.string().nullable(),
    }),
  )
  .withOutput(governanceWriteAcknowledgedSchema)

  .mutation("assignProject")
  .withInput(
    z.object({
      ...organizationScope.shape,
      projectId: z.string(),
      departmentId: z.string().nullable(),
    }),
  )
  .withOutput(governanceWriteAcknowledgedSchema)
  .build();
