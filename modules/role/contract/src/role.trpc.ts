/**
 * Every `role.*` procedure, declared once: its name, its kind, what it takes
 * and what it answers. The server binds a permission and a handler to a name
 * declared here; the browser reads the same names and schemas as types.
 */
import { defineTrpcContract } from "@langwatch/api/contract";

import {
  roleApiCreateInputSchema,
  roleApiOrganizationInputSchema,
  roleApiRoleInputSchema,
  roleApiUpdateInputSchema,
  roleApiUserRoleAssignmentInputSchema,
} from "./role.schemas.ts";
import { roleSchema, roleWriteAcknowledgedSchema } from "./role.ts";

export const roleTrpc = defineTrpcContract("role")
  .query("getAll")
  .withInput(roleApiOrganizationInputSchema)
  .withOutput(roleSchema.array())

  .query("getById")
  .withInput(roleApiRoleInputSchema)
  .withOutput(roleSchema)

  .mutation("create")
  .withInput(roleApiCreateInputSchema)
  .withOutput(roleSchema)

  .mutation("update")
  .withInput(roleApiUpdateInputSchema)
  .withOutput(roleSchema)

  .mutation("delete")
  .withInput(roleApiRoleInputSchema)
  .withOutput(roleWriteAcknowledgedSchema)

  .mutation("assignToUser")
  .withInput(roleApiUserRoleAssignmentInputSchema)
  .withOutput(roleWriteAcknowledgedSchema)

  .mutation("removeFromUser")
  .withInput(roleApiUserRoleAssignmentInputSchema)
  .withOutput(roleWriteAcknowledgedSchema)
  .build();
