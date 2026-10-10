import { defineTrpcContract, moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { authorizeDefaults } from "../../__tests__/api-double.ts";
import { jsonTextField } from "../../json-text-field.ts";
import {
  createTrpcRuntime,
  defineTrpcRouter,
  TrpcRootDefinition,
  type TrpcRuntimeMembers,
} from "../runtime.ts";

// Rulings 2026-10-06, round 7 (Q39): JSON text is parsed at the door, not in the handler.

interface ChartApi {
  save(input: { graph: Record<string, unknown> }): Promise<void>;
}

const ChartApi = moduleApi<ChartApi>()("dashboard");

const contract = defineTrpcContract("chart")
  .mutation("save")
  .withInput(
    z.object({ projectId: z.string(), graph: jsonTextField(z.record(z.string(), z.unknown())) }),
  )
  .build();

type ChartContext = { actor: { id: string } };

const root = TrpcRootDefinition.forContext<ChartContext>().create({});

const members: TrpcRuntimeMembers<ChartContext> = {
  identity: { caller: (ctx) => ({ actor: { type: "user", id: ctx.actor.id } }) },
  authorization: {
    forRequest: () => ({
      ...authorizeDefaults,
      getDecision: async () => ({ permitted: true, organizationRole: null }),
      getProjectAnyDecision: async () => ({ permitted: true, organizationRole: null }),
      checkScopeLineage: async () => ({ kind: "consistent" }),
    }),
  },
  denials: {
    membershipDisabled: () => new Error("membership disabled"),
    liteMemberRestricted: () => new Error("lite member"),
  },
  audit: { record: async () => {}, redact: ({ args }) => args, exempt: () => false },
  errors: {
    report: () => {},
    asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
    translate: () => undefined,
  },
};

/** A caller over one mounted `chart.save`, recording what the handler was handed. */
function mountedSave() {
  const handed: unknown[] = [];
  const declaration = defineTrpcRouter(ChartApi, contract)
    .procedure("save")
    .withPermission("analytics:manage")
    .handle((async ({ input }: { input: { graph: unknown } }) => {
      handed.push(input.graph);
    }) as never)
    .build();

  const caller = createTrpcRuntime({ root, procedure: root.procedure, members })
    .mount(declaration, () => ({ save: async () => {} }))
    .createCaller({ actor: { id: "user-1" } });

  return { handed, save: (graph: string) => caller.save({ projectId: "project-1", graph }) };
}

describe("a mounted procedure with a JSON-text field", () => {
  /** @scenario "A JSON-text field hands the handler the parsed value" */
  it("hands the handler the parsed record", async () => {
    const { handed, save } = mountedSave();

    await save('{"graphType":"line"}');

    expect(handed).toEqual([{ graphType: "line" }]);
  });

  /** @scenario "A malformed JSON-text field is a 400 schema issue" */
  it.each(["{not json", "[1, 2]", "null"])(
    "refuses %s as BAD_REQUEST before the handler",
    async (text) => {
      const { handed, save } = mountedSave();

      await expect(save(text)).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(handed).toEqual([]);
    },
  );
});
