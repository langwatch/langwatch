import { afterAll, describe, expect, it } from "vitest";
import { featureSourceLayoutRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { contract: {}, server: {} } } },
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
      expect(found[0].data).toEqual({ name: "commands.ts", artifact: "commands" });
    });
  });

  describe("when it names a server-only artifact", () => {
    /** @scenario "A server-only artifact in contract source is reported" */
    it("reports contractServerArtifact", () => {
      const found = report("modules/agent/contract/src/agent.repository.ts");

      expect(found.map((e) => e.messageId)).toEqual(["contractServerArtifact"]);
    });
  });
});

describe("given a strict feature server module", () => {
  it.each([
    'export function check() { throw new Error("invalid"); }',
    'import { AgentBusyError } from "@langwatch/agent-contract"; export function check() { throw new AgentBusyError({}); }',
    'import { AgentBusyError as Busy } from "@langwatch/agent-contract"; export function check() { throw new Busy({}); }',
  ])("allows deterministic thrown contract errors: %s", (code) => {
    expect(report("modules/agent/server/src/rules/agent.rules.ts", code)).toEqual([]);
  });

  it.each([
    "export function check(Error) { throw new Error(); }",
    'import { AgentBusyError } from "@langwatch/agent-contract"; export function check(AgentBusyError) { throw new AgentBusyError(); }',
    'import { AgentBusyError } from "@langwatch/agent-server"; export function check() { throw new AgentBusyError(); }',
    'import { Effect as FakeError } from "@langwatch/agent-contract"; export function check() { throw new FakeError(); }',
    'import { AgentBusyError } from "@langwatch/agent-contract"; export const error = new AgentBusyError();',
    "export function check() { throw new Error(new NetworkClient()); }",
  ])("keeps effectful or indirect construction out of rules: %s", (code) => {
    expect(
      report("modules/agent/server/src/rules/agent.rules.ts", code).map(
        (finding) => finding.messageId,
      ),
    ).toEqual(["rulesImpurity"]);
  });

  describe("when a service filename ends in -process.service.ts", () => {
    /** @scenario "A process manager named as a service is reported" */
    it("reports processManagerService", () => {
      const found = report("modules/agent/server/src/services/agent-process.service.ts");

      expect(found.map((e) => e.messageId)).toEqual(["processManagerService"]);
    });
  });

  describe("when a rules module constructs a class", () => {
    /** @scenario "A rules module constructing a class is reported" */
    it("reports rulesImpurity naming the class", () => {
      const found = report(
        "modules/agent/server/src/rules/agent.rules.ts",
        "export class Helper {} export const x = new Helper();",
      );

      expect(found.map((e) => e.messageId)).toEqual(["rulesImpurity"]);
      expect(found[0].data.found).toBe("a class");
    });
  });

  describe("when a source path has no home in layout v0", () => {
    /** @scenario "A path with no strict layout home is reported with the allowed homes" */
    it("reports serverPath listing the allowed directories", () => {
      const found = report("modules/agent/server/src/misc/agent.helper.ts");

      expect(found.map((e) => e.messageId)).toEqual(["serverPath"]);
      expect(found[0].message).toContain("Only this shape is allowed");
      expect(found[0].message).toContain("services/<name>.service.ts");
      expect(found[0].message).not.toContain("transport/<surface>/");
    });
  });

  describe("when the path matches a recognized server pattern", () => {
    /** @scenario "A recognized strict server path is left alone" */
    it("reports nothing", () => {
      expect(report("modules/agent/server/src/services/agent.service.ts")).toEqual([]);
    });

    it("accepts direct API declarations and WebSocket protocol integrations", () => {
      expect(report("modules/agent/server/src/transport/agent.rest.ts")).toEqual([]);
      expect(report("modules/agent/server/src/transport/agent.trpc.ts")).toEqual([]);
      expect(report("modules/agent/server/src/transport/agent-connect.ws.ts")).toEqual(
        [],
      );
      expect(
        report("modules/agent/server/src/transport/agent.handler.ts").map(
          (finding) => finding.messageId,
        ),
      ).toEqual(["serverPath"]);
    });

    it("accepts repository provider bundles, registries, and local stores", () => {
      expect(
        report("modules/agent/server/src/repositories/agent-repositories.registry.ts"),
      ).toEqual([]);
      expect(
        report("modules/agent/server/src/repositories/agent.repositories.ts"),
      ).toEqual([]);
      expect(
        report(
          "modules/agent/server/src/repositories/prisma/prisma.agent.repositories.ts",
        ),
      ).toEqual([]);
      expect(
        report(
          "modules/agent/server/src/repositories/memory/memory.agent-session.database.ts",
        ),
      ).toEqual([]);
    });
  });
});

it.each([
  "modules/agent/contract/src/agent.app.ts",
  "modules/agent/server/src/agent.server.ts",
  "modules/agent/server/src/app/agent.app.ts",
])("accepts the app composition home %s", (file) => {
  expect(report(file)).toEqual([]);
});

it("requires a subject on an app contract filename", () => {
  expect(
    report("modules/agent/contract/src/app.ts").map((entry) => entry.messageId),
  ).toEqual(["contractMissingSubject"]);
});

it("accepts the canonical feature API contract", () => {
  expect(report("modules/agent/contract/src/agent.api.ts")).toEqual([]);
});

it.each([
  "modules/agent/contract/src/other.api.ts",
  "modules/agent/contract/src/nested/agent.api.ts",
])("keeps noncanonical API modules out of contracts: %s", (file) => {
  expect(report(file).map((entry) => entry.messageId)).toEqual(["contractServerArtifact"]);
});

describe("given a channel in a strict feature server module", () => {
  describe("when the interface sits at channels/<subject>.channel.ts", () => {
    /** @scenario "A channel interface lives at channels/<subject>.channel.ts" */
    it("reports nothing", () => {
      expect(report("modules/agent/server/src/channels/webhook.channel.ts")).toEqual([]);
    });
  });

  describe("when an implementation is named for its tier folder", () => {
    /** @scenario "A channel implementation is named for its tier folder" */
    it("reports nothing", () => {
      expect(report("modules/agent/server/src/channels/http/http.webhook.channel.ts")).toEqual([]);
      expect(
        report("modules/agent/server/src/channels/memory/memory.webhook.channel.ts"),
      ).toEqual([]);
      expect(report("modules/agent/server/src/channels/agent-channels.registry.ts")).toEqual([]);
    });
  });

  describe("when an implementation claims a tier it does not sit in", () => {
    /** @scenario "A channel implementation in the wrong tier folder is refused" */
    it("reports serverPath", () => {
      const found = report("modules/agent/server/src/channels/http/redis.webhook.channel.ts");

      expect(found.map((e) => e.messageId)).toEqual(["serverPath"]);
    });
  });
});
