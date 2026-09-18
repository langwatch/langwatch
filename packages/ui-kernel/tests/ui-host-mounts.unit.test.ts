import { describe, expect, it } from "vitest";

import {
  BrowserHostUnmountedError,
  checkHostMounts,
  defineWebModule,
  findUnmountedHostOwners,
  findUnrequiredHostMounts,
  installedModuleHostMounts,
  BrowserHostUnrequiredError,
} from "../src/index.ts";

/** A mount's loader is not exercised here: this file is about the NAMES. */
const stubMount = { load: async () => ({ default: () => null }) };

function mountMap(hosts: readonly string[]): Record<string, typeof stubMount> {
  return Object.fromEntries(hosts.map((host) => [host, stubMount]));
}

describe("findUnmountedHostOwners", () => {
  it("returns nothing when every required host is mounted somewhere", () => {
    const module = defineWebModule("trace").withHosts({
      requires: ["TraceHostApi"],
      mounts: { TraceHostApi: stubMount },
    });

    expect(findUnmountedHostOwners({ modules: [module] })).toEqual([]);
  });

  it("does not refuse a host a peer module mounts on its behalf", () => {
    const scenario = defineWebModule("scenario").withHosts({ requires: ["WorkflowHostApi"] });
    const workflow = defineWebModule("workflow").withHosts({
      mounts: { WorkflowHostApi: stubMount },
    });

    expect(findUnmountedHostOwners({ modules: [scenario, workflow] })).toEqual([]);
  });

  it("does not refuse a host the composing shell mounts outside any module", () => {
    const navigation = defineWebModule("navigation").withHosts({ requires: ["NavigationHost"] });

    expect(
      findUnmountedHostOwners({ modules: [navigation], mountedByShell: ["NavigationHost"] }),
    ).toEqual([]);
  });

  it("collects every owing module, not only the first", () => {
    const trace = defineWebModule("trace").withHosts({ requires: ["TraceHostApi"] });
    const auth = defineWebModule("auth").withHosts({ requires: ["AuthHostApi"] });
    const prompt = defineWebModule("prompt").withHosts({ requires: ["PromptHostApi"] });

    const owners = findUnmountedHostOwners({ modules: [trace, auth, prompt] });

    expect(owners).toEqual([
      { module: "trace", host: "TraceHostApi" },
      { module: "auth", host: "AuthHostApi" },
      { module: "prompt", host: "PromptHostApi" },
    ]);
  });

  it("reproduces the measured production split: 39 hosts, 5 mounted, 34 owing", () => {
    // Every `*HostProvider` definition found under modules/, enterprise/modules/
    // and packages/browser-host on 2026-09-18, and who (if anyone) mounts it in
    // production. See dev/docs/ARCHITECTURE.md §10.1 and this task's handoff for
    // the audit this table was read from.
    const owningModuleHosts: Readonly<Record<string, readonly string[]>> = {
      agent: ["AgentManagementHost"],
      analytics: ["AnalyticsHostApi"],
      annotation: ["AnnotationHostApi", "AnnotationScoresHostApi"],
      "api-key": ["ApiKeyHostApi", "AuthorizeHostApi"],
      auth: ["AuthHostApi"],
      authz: ["AuthzHostApi"],
      automation: ["AutomationHost"],
      billing: ["BillingHostApi"],
      "coding-agent": ["CodingAgentActivityHost"],
      "data-privacy": ["DataPrivacyHostApi"],
      "data-retention": ["DataRetentionHostApi"],
      dataset: ["DatasetHostApi"],
      evaluator: ["EvaluatorHostApi"],
      gateway: ["GatewayHostApi"],
      github: ["GithubHostApi"],
      governance: ["GovernanceHostApi"],
      langy: ["LangyHostApi"],
      licensing: ["LicensingHostApi"],
      "model-provider": ["ModelProviderHostApi"],
      monitor: ["MonitorHostApi"],
      navigation: ["NavigationHost"],
      notification: ["NotificationHostApi"],
      onboarding: ["OnboardingHostApi"],
      ops: ["OpsHostApi"],
      organization: ["OrganizationHostApi"],
      user: ["PersonalWorkspaceHostApi"],
      project: ["ProjectHomeHost", "ProjectHostApi"],
      prompt: ["PromptHostApi"],
      scenario: ["ScenarioHostApi"],
      scim: ["ScimHostApi"],
      secret: ["SecretHostApi"],
      topic: ["TopicHostApi"],
      trace: ["TraceHostApi"],
      workflow: ["WorkflowHostApi", "WorkflowNodeHost"],
    };
    // Mounted in production today (ARCHITECTURE.md §10.1's measured five).
    const mountedByPeer: Readonly<Record<string, string>> = {
      CodingAgentActivityHost: "user",
      WorkflowHostApi: "scenario",
    };
    const mountedBySelf = new Set(["WorkflowNodeHost"]);
    const mountedByShell = ["NavigationHost", "UiScopeHost"];

    const extraMounts: Record<string, string[]> = {};
    for (const [host, byModule] of Object.entries(mountedByPeer)) {
      (extraMounts[byModule] ??= []).push(host);
    }

    const modules = Object.entries(owningModuleHosts).map(([name, hosts]) =>
      defineWebModule(name).withHosts({
        requires: hosts,
        mounts: mountMap([
          ...hosts.filter((host) => mountedBySelf.has(host)),
          ...(extraMounts[name] ?? []),
        ]),
      }),
    );

    const owners = findUnmountedHostOwners({ modules, mountedByShell });

    expect(owners).toHaveLength(34);
    expect(owners).toContainEqual({ module: "trace", host: "TraceHostApi" });
    expect(owners).toContainEqual({ module: "auth", host: "AuthHostApi" });
    expect(
      owners.some((owner) => owner.module === "coding-agent" || owner.host === "NavigationHost"),
    ).toBe(false);
  });
});

describe("checkHostMounts", () => {
  it("throws one BrowserHostUnmountedError naming every module, not the first", () => {
    const trace = defineWebModule("trace").withHosts({ requires: ["TraceHostApi"] });
    const auth = defineWebModule("auth").withHosts({ requires: ["AuthHostApi"] });

    let caught: unknown;
    try {
      checkHostMounts({ modules: [trace, auth] });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BrowserHostUnmountedError);
    const error = caught as BrowserHostUnmountedError;
    expect(error.code).toBe("browser_host_unmounted");
    expect(error.owners).toEqual([
      { module: "trace", host: "TraceHostApi" },
      { module: "auth", host: "AuthHostApi" },
    ]);
    expect(error.message).toBe(
      [
        'Module "trace" declares TraceHostApi and nothing mounts it.',
        'Module "auth" declares AuthHostApi and nothing mounts it.',
      ].join("\n"),
    );
  });

  it("does not throw when nothing is outstanding", () => {
    const module = defineWebModule("trace").withHosts({
      requires: ["TraceHostApi"],
      mounts: { TraceHostApi: stubMount },
    });

    expect(() => checkHostMounts({ modules: [module] })).not.toThrow();
  });
});

describe("findUnrequiredHostMounts", () => {
  /** @scenario "A host mounted under a name nothing reads is refused" */
  it("names a mount whose host no installed module requires", () => {
    const workflow = defineWebModule("workflow").withHosts({
      requires: ["WorkflowHostApi"],
      mounts: { WorkflowHost: stubMount },
    });

    expect(findUnrequiredHostMounts({ modules: [workflow] })).toEqual([
      { module: "workflow", host: "WorkflowHost" },
    ]);
  });

  it("accepts a mount a peer module requires", () => {
    const scenario = defineWebModule("scenario").withHosts({ requires: ["WorkflowHostApi"] });
    const workflow = defineWebModule("workflow").withHosts({
      mounts: { WorkflowHostApi: stubMount },
    });

    expect(findUnrequiredHostMounts({ modules: [scenario, workflow] })).toEqual([]);
  });

  /** @scenario "A host mounted under a name nothing reads is refused" */
  it("refuses at install once every required host IS mounted", () => {
    // Both halves declared, one of them misspelled: the unmounted check has
    // nothing to say here, which is exactly when the typo used to survive.
    const workflow = defineWebModule("workflow").withHosts({
      requires: ["WorkflowHostApi"],
      mounts: { WorkflowHostApi: stubMount, WorkflowHost: stubMount },
    });

    expect(() => checkHostMounts({ modules: [workflow] })).toThrowError(BrowserHostUnrequiredError);
  });
});

describe("installedModuleHostMounts", () => {
  /** @scenario "Every declared mount is collected, named by its module and host" */
  it("collects every module's mounts in install order, named by module and host", () => {
    const secret = defineWebModule("secret").withHosts({
      requires: ["SecretHostApi"],
      mounts: { SecretHostApi: stubMount },
    });
    const workflow = defineWebModule("workflow").withHosts({
      requires: ["WorkflowHostApi"],
      mounts: { WorkflowHostApi: stubMount },
    });

    expect(
      installedModuleHostMounts([secret, workflow]).map(({ module, host }) => ({ module, host })),
    ).toEqual([
      { module: "secret", host: "SecretHostApi" },
      { module: "workflow", host: "WorkflowHostApi" },
    ]);
  });

  /** @scenario "Every declared mount is collected, named by its module and host" */
  it("carries the loader the declaration named", async () => {
    const mount = { load: async () => ({ default: () => null }) };
    const secret = defineWebModule("secret").withHosts({
      requires: ["SecretHostApi"],
      mounts: { SecretHostApi: mount },
    });

    const [collected] = installedModuleHostMounts([secret]);

    expect(collected?.load).toBe(mount.load);
  });
});
