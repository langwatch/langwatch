import { RoleBindingTrpcApi, roleBindingTrpcInputSchemas } from "@langwatch/role-server";
import { protectedProcedure } from "~/server/api/trpc.permission-builder";
import { appTrpcRoot } from "~/server/api/trpc.root";

const inputs = roleBindingTrpcInputSchemas();

/** Process transport mount for mixed tRPC batches; feature behaviour is package-owned. */
export const roleBindingRouter = RoleBindingTrpcApi.create(appTrpcRoot, {
  listForOrg: protectedProcedure.input(inputs.listForOrg).permission("organization:manage"),
  listForUser: protectedProcedure.input(inputs.listForUser).permission("organization:manage"),
  getMyAccessBreakdown: protectedProcedure
    .input(inputs.getMyAccessBreakdown)
    .permission("organization:view"),
  create: protectedProcedure.input(inputs.create).permission("organization:manage"),
  update: protectedProcedure.input(inputs.update).permission("organization:manage"),
  delete: protectedProcedure.input(inputs.delete).permission("organization:manage"),
  applyMemberBindings: protectedProcedure
    .input(inputs.applyMemberBindings)
    .permission("organization:manage"),
});
