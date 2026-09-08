/**
 * What a server declaration refuses at runtime: a name the contract never
 * declared, the same name twice, and a build that left one unimplemented.
 * The type layer refuses all three first; these are the guards behind it.
 *
 * Spec: packages/api/specs/transport-declaration-split.feature.
 */

import { featureApi } from "@langwatch/runtime-composition";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineTrpcContract } from "../../contract/trpc-contract.ts";
import { defineTrpcRouter, type TrpcProcedureFactory } from "../trpc-router.ts";

interface ReviewApi {
  read(input: { id: string }): Promise<{ id: string; comment: string }>;
}

const ReviewApi = featureApi<ReviewApi>("annotation");

const contract = defineTrpcContract("review")
  .query("getById")
  .withInput(z.object({ projectId: z.string(), id: z.string() }))
  .withOutput(z.object({ id: z.string(), comment: z.string() }))

  .mutation("archive")
  .withInput(z.object({ projectId: z.string(), id: z.string() }))
  .build();

/** A runtime that records nothing: these refusals happen before it is asked. */
const runtime: TrpcProcedureFactory<object> = {
  procedure: () => ({}),
  router: (record) => record,
};

describe("binding a server to a contract at runtime", () => {
  /** @scenario "A server implementation may only name procedures the contract declared" */
  it("refuses a name the contract does not declare", () => {
    expect(() => defineTrpcRouter(ReviewApi, contract).procedure("purge" as never)).toThrow(
      /declares no procedure "purge"/,
    );
  });

  /** @scenario "A procedure cannot be implemented twice or left unimplemented" */
  it("names the procedure implemented twice, and the one never implemented", () => {
    const once = defineTrpcRouter(ReviewApi, contract)
      .procedure("getById")
      .withPermission("annotations:view")
      .handle(async () => ({ id: "annotation-1", comment: "read" }));

    expect(() => once.procedure("getById" as never)).toThrow(
      /implements procedure "getById" twice/,
    );

    // `build()` refuses at compile time; `Reflect.apply` is how the runtime
    // guard behind it is reached at all.
    const declaration: {
      router(factory: TrpcProcedureFactory<object>, app: () => ReviewApi): object;
    } = Reflect.apply(once.build, once, []);

    expect(() => declaration.router(runtime, () => ({}) as ReviewApi)).toThrow(
      /no implementation for procedure "archive"/,
    );
  });
});
