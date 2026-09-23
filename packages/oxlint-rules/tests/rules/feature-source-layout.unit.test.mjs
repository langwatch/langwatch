import { afterAll, describe, expect, it } from "vitest";

import { featureSourceLayoutRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { contract: {}, process: {} } } },
});

afterAll(() => workspace.cleanup());

function report(filename, code = "export const x = 1;") {
  return runRule(featureSourceLayoutRule, { code, cwd: workspace.cwd, filename });
}

describe("given a strict feature contract module", () => {
  describe("when it names only the artifact and not the subject", () => {
    /** @scenario "A contract artifact missing its subject is reported" */
    it("reports contractMissingSubject with the artifact", () => {
      const found = report("modules/agent/contract/src/commands.ts");

      expect(found.map((e) => e.messageId)).toEqual(["contractMissingSubject"]);
      expect(found[0].data).toEqual({
        feature: "agent",
        name: "commands.ts",
        artifact: "commands",
      });
    });
  });

  describe("when it names a process-only artifact", () => {
    /** @scenario "A process-only artifact in contract source is reported" */
    it.each([
      ["agent.repository.ts", "`repositories/`"],
      ["agent.channel.ts", "`channels/`"],
      ["agent.subscriber.ts", "`eventing/`"],
    ])("reports contractProcessArtifact for %s and names its process home", (name, home) => {
      const found = report(`modules/agent/contract/src/${name}`);

      expect(found.map((e) => e.messageId)).toEqual(["contractProcessArtifact"]);
      expect(found[0].message).toContain("modules/agent/process/src/");
      expect(found[0].message).toContain(home);
    });

    /** @scenario "A process-only artifact in contract source is reported" */
    it("never names an adapter or a port as a shape", () => {
      const found = report("modules/agent/contract/src/agent.repository.ts");

      expect(found[0].message).not.toMatch(/adapter|\.port/);
    });
  });
});

describe("given a strict feature process module", () => {
  it.each([
    'export function check() { throw new Error("invalid"); }',
    'import { AgentBusyError } from "@langwatch/agent-contract"; export function check() { throw new AgentBusyError({}); }',
    'import { AgentBusyError as Busy } from "@langwatch/agent-contract"; export function check() { throw new Busy({}); }',
  ])("allows deterministic thrown contract errors: %s", (code) => {
    expect(report("modules/agent/process/src/rules/agent.rules.ts", code)).toEqual([]);
  });

  it.each([
    "export function check(Error) { throw new Error(); }",
    'import { AgentBusyError } from "@langwatch/agent-contract"; export function check(AgentBusyError) { throw new AgentBusyError(); }',
    'import { AgentBusyError } from "@langwatch/agent-process"; export function check() { throw new AgentBusyError(); }',
    'import { Effect as FakeError } from "@langwatch/agent-contract"; export function check() { throw new FakeError(); }',
    'import { AgentBusyError } from "@langwatch/agent-contract"; export const error = new AgentBusyError();',
    "export function check() { throw new Error(new NetworkClient()); }",
  ])("keeps effectful or indirect construction out of rules: %s", (code) => {
    expect(
      report("modules/agent/process/src/rules/agent.rules.ts", code).map(
        (finding) => finding.messageId,
      ),
    ).toEqual(["rulesImpurity"]);
  });

  describe("when a service filename ends in -process.service.ts", () => {
    /** @scenario "A process manager named as a service is reported" */
    it("reports processManagerService pointing at the eventing folder", () => {
      const found = report("modules/agent/process/src/services/agent-process.service.ts");

      expect(found.map((e) => e.messageId)).toEqual(["processManagerService"]);
      expect(found[0].message).toContain("`eventing/agent.process.ts`");
      expect(found[0].message).not.toContain("processes/");
      expect(report("modules/agent/process/src/eventing/agent.process.ts")).toEqual([]);
    });
  });

  describe("when a rules module constructs a class", () => {
    /** @scenario "A rules module constructing a class is reported" */
    it("reports rulesImpurity naming the class", () => {
      const found = report(
        "modules/agent/process/src/rules/agent.rules.ts",
        "export class Helper {} export const x = new Helper();",
      );

      expect(found.map((e) => e.messageId)).toEqual(["rulesImpurity"]);
      expect(found[0].data.found).toBe("a class");
    });
  });

  describe("when a source path has no home in layout v0", () => {
    /** @scenario "A path with no strict layout home is reported with the allowed homes" */
    it("reports processPath listing the allowed directories", () => {
      const found = report("modules/agent/process/src/misc/agent.helper.ts");

      expect(found.map((e) => e.messageId)).toEqual(["processPath"]);
      expect(found[0].message).toContain("Only this shape is allowed");
      expect(found[0].message).toContain("services/<name>.service.ts");
      expect(found[0].message).not.toContain("transport/<surface>/");
      expect(found[0].message).not.toMatch(/adapter|ports\//);
    });
  });

  describe("when the path matches a recognized process pattern", () => {
    /** @scenario "A recognized strict process path is left alone" */
    it("reports nothing", () => {
      expect(report("modules/agent/process/src/services/agent.service.ts")).toEqual([]);
    });

    it("accepts direct API declarations and WebSocket protocol integrations", () => {
      expect(report("modules/agent/process/src/transport/agent.rest.ts")).toEqual([]);
      expect(report("modules/agent/process/src/transport/agent.trpc.ts")).toEqual([]);
      expect(report("modules/agent/process/src/transport/agent-connect.ws.ts")).toEqual([]);
      expect(
        report("modules/agent/process/src/transport/agent.handler.ts").map(
          (finding) => finding.messageId,
        ),
      ).toEqual(["processPath"]);
    });

    it("accepts repository provider bundles, registries, and local stores", () => {
      expect(
        report("modules/agent/process/src/repositories/agent-repositories.registry.ts"),
      ).toEqual([]);
      expect(report("modules/agent/process/src/repositories/agent.repositories.ts")).toEqual([]);
      expect(
        report("modules/agent/process/src/repositories/prisma/prisma.agent.repositories.ts"),
      ).toEqual([]);
      expect(
        report("modules/agent/process/src/repositories/memory/memory.agent-session.database.ts"),
      ).toEqual([]);
    });
  });
});

it.each([
  "modules/agent/contract/src/agent.app.ts",
  "modules/agent/process/src/agent.server.ts",
  "modules/agent/process/src/app/agent.app.ts",
])("accepts the app composition home %s", (file) => {
  expect(report(file)).toEqual([]);
});

it("requires a subject on an app contract filename", () => {
  expect(report("modules/agent/contract/src/app.ts").map((entry) => entry.messageId)).toEqual([
    "contractMissingSubject",
  ]);
});

it("accepts the canonical feature API contract", () => {
  expect(report("modules/agent/contract/src/agent.api.ts")).toEqual([]);
});

it.each([
  "modules/agent/contract/src/other.api.ts",
  "modules/agent/contract/src/nested/agent.api.ts",
])("keeps noncanonical API modules out of contracts: %s", (file) => {
  expect(report(file).map((entry) => entry.messageId)).toEqual(["contractProcessArtifact"]);
});

describe("given a channel in a strict feature process module", () => {
  describe("when the interface sits at channels/<subject>.channel.ts", () => {
    /** @scenario "A channel interface lives at channels/<subject>.channel.ts" */
    it("reports nothing", () => {
      expect(report("modules/agent/process/src/channels/webhook.channel.ts")).toEqual([]);
    });
  });

  describe("when an implementation is named for its tier folder", () => {
    /** @scenario "A channel implementation is named for its tier folder" */
    it("reports nothing", () => {
      expect(report("modules/agent/process/src/channels/http/http.webhook.channel.ts")).toEqual([]);
      expect(report("modules/agent/process/src/channels/memory/memory.webhook.channel.ts")).toEqual(
        [],
      );
      expect(report("modules/agent/process/src/channels/agent-channels.registry.ts")).toEqual([]);
    });
  });

  describe("when an implementation claims a tier it does not sit in", () => {
    /** @scenario "A channel implementation in the wrong tier folder is refused" */
    it("reports serverPath", () => {
      const found = report("modules/agent/process/src/channels/http/redis.webhook.channel.ts");

      expect(found.map((e) => e.messageId)).toEqual(["processPath"]);
    });
  });
});
