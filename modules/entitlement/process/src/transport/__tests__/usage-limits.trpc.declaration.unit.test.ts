/**
 * Each `limits.*` procedure is bound once, with the permission its read or mail needs.
 * @see ../../../../../../specs/licensing/usage-page.feature
 */
import type { TrpcProcedureFactory } from "@langwatch/api/trpc";
import { usageLimitsTrpc } from "@langwatch/entitlement-contract";
import { expect, it } from "vitest";

import { usageLimitsTrpcTransport } from "../usage-limits.trpc.ts";

type TestContext = object;
type ProcedureAccess = Parameters<TrpcProcedureFactory<TestContext>["procedure"]>[0]["access"];

/** Records the access each declared procedure asked for, building nothing. */
function accessDeclared(): unknown[] {
  const declared: unknown[] = [];
  const runtime: TrpcProcedureFactory<TestContext> = {
    procedure: ({ access }: { access: ProcedureAccess }) => {
      declared.push(access.kind === "permission" ? access.permission : access);
      return {};
    },
    router: (record) => record,
  } as TrpcProcedureFactory<TestContext>;
  usageLimitsTrpcTransport.router(runtime, () => {
    throw new Error("This test mounts but never handles a request");
  });
  return declared;
}

/** @scenario "Only organization administrators read the month breakdown" */
it("asks organization:manage for the month breakdown and keeps the other two as they were", () => {
  const declared = accessDeclared();

  expect(
    Object.entries(usageLimitsTrpc.members).map(([name, member], index) => [
      name,
      member.kind,
      declared[index],
    ]),
  ).toEqual([
    ["getUsage", "query", "organization:view"],
    ["getMonthBreakdown", "query", "organization:manage"],
    ["checkAndSendUsageLimitNotification", "mutation", "organization:manage"],
  ]);
});
