import { moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";

import { MissingProviderError } from "../boot-errors.ts";
import { bootInstalledProcess } from "../boot-installed-process.ts";
import { defineProcessModule, type FeatureSetup } from "../feature-installer.ts";
import { WorkerProcessContainer, type ProcessBoot } from "../process-container.ts";

interface PeerApi {
  read(): string;
}
const WorkflowApi = moduleApi<PeerApi>()("workflow");
const AuditLogApi = moduleApi<PeerApi>()("audit-log");

function runtime(): ProcessBoot {
  return {
    surfaceDefaults: {},
    boot: ({ role, modules }) =>
      bootInstalledProcess({
        role,
        modules,
        config: {},
        stores: {
          order: [],
          read(name) {
            throw new Error(`Unexpected member: ${name}`);
          },
        },
        surface: () => ({ hosts: {}, serve: () => "handler" }),
      }),
  };
}

function peerModule({
  name,
  token,
}: {
  name: "workflow" | "audit-log";
  token: typeof WorkflowApi | typeof AuditLogApi;
}) {
  class PeerApp {
    static readonly contract = token;
    static readonly dependencies = {};
    static create(_setup: FeatureSetup<Record<never, never>, undefined>) {
      return { read: () => name };
    }
  }
  return defineProcessModule(name).withApi(PeerApp).build();
}

function dependentModule({ constructed }: { constructed: string[] }) {
  const DependentApi = moduleApi<PeerApi>()("agent");
  class DependentApp {
    static readonly contract = DependentApi;
    static readonly dependencies = { workflows: WorkflowApi, auditLog: AuditLogApi };
    static create(_setup: FeatureSetup<typeof DependentApp.dependencies, undefined>) {
      constructed.push("agent");
      return { read: () => "agent" };
    }
  }
  return defineProcessModule("agent").withApi(DependentApp).build();
}

describe("given a module that declares other modules' Apis as peers", () => {
  describe("when a process installs it without the modules that provide them", () => {
    /**
     * @scenario "A missing peer refuses by name"
     * @scenario "A process installing agent without the modules it needs refuses to boot"
     * @scenario "A module whose collaborating module is not installed refuses to boot"
     * @scenario "A process installing a module that needs authorization without the authz module refuses to boot"
     * @scenario "A process missing a module the record needs refuses to boot by name"
     * @scenario "A deployment that did not install a needed module refuses to boot by name"
     */
    it("refuses the boot naming the module and the peer, and constructs nothing", async () => {
      const constructed: string[] = [];
      const container = new WorkerProcessContainer(runtime(), [dependentModule({ constructed })]);

      const refusal = await container.boot().then(
        () => undefined,
        (error: unknown) => error,
      );

      expect(refusal).toBeInstanceOf(MissingProviderError);
      expect(refusal).toMatchObject({ feature: "agent", dependencyKey: "workflows" });
      expect(constructed).toEqual([]);
    });
  });

  describe("when a process installs it with the modules that provide them", () => {
    /** @scenario "A module whose collaborating module is installed boots and is answered by it" */
    it("boots, and the module reaches its peers through the installed modules", async () => {
      const constructed: string[] = [];
      const container = new WorkerProcessContainer(runtime(), [
        peerModule({ name: "workflow", token: WorkflowApi }),
        peerModule({ name: "audit-log", token: AuditLogApi }),
        dependentModule({ constructed }),
      ]);

      const booted = await container.boot();

      expect(constructed).toEqual(["agent"]);
      expect(booted.service(WorkflowApi).read()).toBe("workflow");
      await booted.stop();
    });
  });
});
