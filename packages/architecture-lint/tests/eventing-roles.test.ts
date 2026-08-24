import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lintEventingRoles } from "../src/eventing-roles";
import type { ClassifiedPackage } from "../src/types";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "langwatch-eventing-roles-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, source: string): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source, "utf8");
}

function strictServer(feature = "agent"): ClassifiedPackage {
  const packageRoot = join(root, "packages", "features", feature, "server");
  return {
    name: `@langwatch/${feature}-server`,
    root: packageRoot,
    manifestPath: join(packageRoot, "package.json"),
    manifest: { name: `@langwatch/${feature}-server` },
    kind: "server",
    feature,
    featureRoot: join(root, "packages", "features", feature),
    layoutVersion: 0,
    subjects: [feature],
    enterprise: false,
  };
}

function policies(packages: readonly ClassifiedPackage[] = []): string[] {
  return lintEventingRoles(root, packages).map(({ policy }) => policy);
}

describe("Eventing role lint", () => {
  it("accepts synchronous projection evolution and command dispatch from a subscriber", () => {
    write(
      "platform/app/src/order.projection.ts",
      "export const project = (state: number) => state + 1;",
    );
    write(
      "platform/app/src/order.subscriber.ts",
      "export const handle = (commands: { send(): Promise<void> }) => commands.send();",
    );

    expect(policies()).toEqual([]);
  });

  it("rejects asynchronous and network work in a projection", () => {
    write(
      "platform/app/src/order.projection.ts",
      'import "node:http"; export async function project() { await fetch("https://example.com"); }',
    );

    expect(policies()).toContain("eventing-projection-purity");
  });

  it("rejects durable event fabrication from a subscriber", () => {
    write(
      "platform/app/src/order.subscriber.ts",
      "export const handle = (EventUtils: { createEvent(): void }) => EventUtils.createEvent();",
    );

    expect(policies()).toContain("eventing-durable-event-path");
  });

  it("rejects external work from a process definition", () => {
    write(
      "platform/app/src/order.process.ts",
      "export async function evolve() { await new Promise((resolve) => setTimeout(resolve, 1)); }",
    );

    expect(policies()).toContain("eventing-process-purity");
  });

  it("requires a named redelivery test for every strict-package subscriber", () => {
    const pkg = strictServer();
    write(
      "packages/features/agent/server/src/subscribers/agent.subscriber.ts",
      "export class AgentSubscriber {}",
    );

    expect(policies([pkg])).toContain("eventing-subscriber-idempotency");

    write(
      "packages/features/agent/server/tests/subscribers/agent.subscriber.redelivery.test.ts",
      "export {};",
    );
    expect(policies([pkg])).not.toContain("eventing-subscriber-idempotency");
  });
});
