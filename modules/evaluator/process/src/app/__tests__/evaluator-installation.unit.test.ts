import { readFileSync } from "node:fs";
import { join } from "node:path";

import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { InstantEvalApi } from "@langwatch/instant-eval-contract";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import { bootInstalledProcess } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { testPeer } from "@langwatch/process/testing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { UserApi } from "@langwatch/user-contract";
import { WorkflowApi } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { evaluatorProcessModule } from "../../evaluator.module.ts";

/** Every host answers with the app its transport was handed, so the test can compare instances. */
function recordingHost(mounted: unknown[]) {
  return { mount: (_declaration: object, app: () => unknown) => void mounted.push(app()) };
}

async function bootEvaluator() {
  const rest: unknown[] = [];
  const trpc: unknown[] = [];
  const runtime = await bootInstalledProcess({
    role: "api",
    modules: [evaluatorProcessModule],
    config: { evaluator: { publicBaseUrl: undefined } },
    members: { ...memoryStores(), close: async () => void 0 },
    peers: [
      testPeer({ token: AuthzApi, instance: createApiFixture<AuthzApi>() }),
      testPeer({ token: AuditLogApi, instance: createApiFixture<AuditLogApi>() }),
      testPeer({ token: UserApi, instance: createApiFixture<UserApi>() }),
      testPeer({ token: WorkflowApi, instance: createApiFixture<WorkflowApi>() }),
      testPeer({ token: ModelProviderApi, instance: createApiFixture<ModelProviderApi>() }),
      testPeer({ token: InstantEvalApi, instance: createApiFixture<InstantEvalApi>() }),
    ],
    surface: () => ({
      hosts: { rest: recordingHost(rest), trpc: recordingHost(trpc) },
      serve: () => undefined,
    }),
  });

  return { runtime, rest, trpc };
}

describe("evaluator installation", () => {
  describe("when the evaluator module boots in the api role", () => {
    /** @scenario "A process composes one evaluator capability" */
    it("hands its REST and tRPC doors the one evaluator service the process answers by token", async () => {
      const { runtime, rest, trpc } = await bootEvaluator();

      try {
        const service = runtime.module(evaluatorProcessModule).provided;

        expect(rest).toHaveLength(1);
        expect(trpc).toHaveLength(1);
        expect(rest[0]).toBe(service);
        expect(trpc[0]).toBe(service);
      } finally {
        await runtime.stop();
      }
    });

    /** @scenario "A process composes one evaluator capability" */
    it("builds no repository or database client in either transport", () => {
      const transportDirectory = join(import.meta.dirname, "..", "..", "transport");
      const sources = ["evaluator.rest.ts", "evaluator.trpc.ts"].map((file) =>
        readFileSync(join(transportDirectory, file), "utf8"),
      );

      for (const source of sources) {
        expect(source).not.toMatch(/from\s+"[^"]*(repositor|prisma|clickhouse)[^"]*"/i);
      }
    });
  });
});
