import { readFileSync } from "node:fs";
import { join } from "node:path";

import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthApi } from "@langwatch/auth-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { EventSourcing } from "@langwatch/eventing";
import { OrganizationApi } from "@langwatch/organization-contract";
import { bootInstalledProcess } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { testPeer } from "@langwatch/process/testing";
import { ProjectApi } from "@langwatch/project-contract";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { githubProcessModule } from "../../github.module.ts";

/** Optional handles read as unset; the install-state key is a low-entropy marker. */
const resolver = SecretsResolver.over(
  SecretsChain.start({ environment: { NEXTAUTH_SECRET: "session-marker" } }).withEnv(),
);

/** The memory stores plus the eventing the module's maintenance pipeline reads. */
function memberSource() {
  const stores = memoryStores();
  const eventing = new EventSourcing({
    enabled: false,
    participation: "produce",
    processManagerMode: "producer-only",
  });

  return {
    tier: stores.tier,
    order: [...stores.order, "eventing"],
    read: (name: string) => (name === "eventing" ? eventing : stores.read(name)),
  };
}

function recordingHost(mounted: unknown[]) {
  return { mount: (_declaration: object, app: () => unknown) => void mounted.push(app()) };
}

async function bootGithub() {
  const rest: unknown[] = [];
  const trpc: unknown[] = [];
  const runtime = await bootInstalledProcess({
    role: "api",
    modules: [githubProcessModule],
    config: {
      github: { appId: undefined, host: undefined, appSlug: undefined, clientId: undefined },
    },
    stores: memberSource(),
    secrets: (owner, declared) => resolver.scopeTo(owner, declared),
    peers: [
      testPeer({ token: OrganizationApi, instance: createApiFixture<OrganizationApi>() }),
      testPeer({ token: ProjectApi, instance: createApiFixture<ProjectApi>() }),
      testPeer({ token: AuthzApi, instance: createApiFixture<AuthzApi>() }),
      testPeer({ token: AuthApi, instance: createApiFixture<AuthApi>() }),
      testPeer({ token: AuditLogApi, instance: createApiFixture<AuditLogApi>() }),
    ],
    surface: () => ({
      hosts: { rest: recordingHost(rest), trpc: recordingHost(trpc) },
      serve: () => undefined,
    }),
  });

  return { runtime, rest, trpc };
}

describe("github installation", () => {
  describe("when the github module boots in the api role", () => {
    /** @scenario "one process composes one GitHub capability" */
    it("hands its REST and tRPC doors the one GitHub app the process booted", async () => {
      const { runtime, rest, trpc } = await bootGithub();

      try {
        const app = runtime.module(githubProcessModule).provided;

        expect(rest).toHaveLength(1);
        expect(trpc).toHaveLength(1);
        expect(rest[0]).toBe(app);
        expect(trpc[0]).toBe(app);
      } finally {
        await runtime.stop();
      }
    });

    /** @scenario "one process composes one GitHub capability" */
    it("builds no repository or provider client in either transport", () => {
      const transportDirectory = join(import.meta.dirname, "..", "..", "transport");
      const sources = ["github-install.rest.ts", "github.trpc.ts"].map((file) =>
        readFileSync(join(transportDirectory, file), "utf8"),
      );

      for (const source of sources) {
        expect(source).not.toMatch(/from\s+"[^"]*(repositor|prisma|clickhouse|octokit)[^"]*"/i);
      }
    });
  });
});
