/**
 * The project's run plans and test suites, installed over this process's own
 * graph. The rows are Postgres; the run projection is the ClickHouse client
 * the root resolved, and a deployment without one folds the projection in
 * memory.
 */
import { AgentApi, type AgentApi as AgentApiContract } from "@langwatch/agent-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { ProjectApi, type ProjectApi as ProjectApiContract } from "@langwatch/project-contract";
import { PromptApi, type PromptApi as PromptApiContract } from "@langwatch/prompt-contract";
import { createApp } from "@langwatch/runtime-composition";
import { ScenarioApi, type ScenarioApi as ScenarioApiContract } from "@langwatch/scenario-contract";
import {
  suiteServer,
  type ConnectedPresenceReader,
  type SuiteAppInfrastructure,
} from "@langwatch/suite-server";

import { createSuiteTrpcRouter } from "./suite-trpc.mount.ts";
import type { ComposedSuiteFeature } from "./suite.composition.types.ts";

/** The other features the suite surface reads through. */
export type SuitePeers = Readonly<{
  scenarios: ScenarioApiContract;
  agents: AgentApiContract;
  prompts: PromptApiContract;
  projects: ProjectApiContract;
}>;

/** What the process supplies for a run to be scheduled and read back. */
export type SuiteInfrastructure = Readonly<{
  execution: SuiteAppInfrastructure["execution"];
  resolveClickHouseClient: SuiteAppInfrastructure["resolveClickHouseClient"];
  defaultRetentionDays: number;
  generateId: () => string;
  /** Which connected agents have a process attached; absent when none is composed. */
  connectedPresence?: ConnectedPresenceReader;
}>;

/** Installs the suite surfaces over this process's own graph. */
export async function installApiSuite(options: {
  prisma: PrismaClient;
  peers: SuitePeers;
  infrastructure: SuiteInfrastructure;
}): Promise<ComposedSuiteFeature> {
  const { peers, infrastructure } = options;

  const runtime = await createApp({ name: "langwatch-api" })
    .withPersistence("postgres", { prisma: options.prisma })
    .withInfrastructure({})
    .withProvided(ScenarioApi, peers.scenarios)
    .withProvided(AgentApi, peers.agents)
    .withProvided(PromptApi, peers.prompts)
    .withProvided(ProjectApi, peers.projects)
    .withFeature(suiteServer, {
      infrastructure: {
        execution: infrastructure.execution,
        resolveClickHouseClient: infrastructure.resolveClickHouseClient,
        defaultRetentionDays: infrastructure.defaultRetentionDays,
        generateId: infrastructure.generateId,
        ...(infrastructure.connectedPresence
          ? { connectedPresence: infrastructure.connectedPresence }
          : {}),
      },
    })
    .boot({ role: "api" });

  const app = runtime.feature(suiteServer).provided;

  return {
    routers: (mount) => ({ suites: createSuiteTrpcRouter(mount) }),
    app,
  };
}
