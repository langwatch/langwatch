import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lintServiceProjectionBoundaries, type ClassifiedPackage } from "../src";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "langwatch-service-projection-boundaries-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, source: string): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source, "utf8");
}

function strictServer(): ClassifiedPackage {
  const featureRoot = join(root, "packages/features/example");
  const packageRoot = join(featureRoot, "server");
  return {
    name: "@langwatch/example-server",
    root: packageRoot,
    manifestPath: join(packageRoot, "package.json"),
    manifest: { name: "@langwatch/example-server" },
    kind: "server",
    feature: "example",
    featureRoot,
    layoutVersion: 0,
    subjects: ["example"],
    enterprise: false,
  };
}

function lint(): ReturnType<typeof lintServiceProjectionBoundaries> {
  return lintServiceProjectionBoundaries([strictServer()]);
}

describe("service projection boundaries", () => {
  it("rejects a projection write store received by a service", () => {
    write(
      "packages/features/example/server/src/services/example.service.ts",
      `
        import type { ProjectionStore as WritableProjection } from "@langwatch/eventing";

        type ExampleServiceOptions = { projection: WritableProjection<unknown> };

        export class ExampleService {
          constructor(private readonly options: ExampleServiceOptions) {}
        }
      `,
    );

    expect(lint()).toMatchObject([
      {
        policy: "service-projection-write-boundary",
      },
    ]);
  });

  it("rejects a service port which exposes projection write methods", () => {
    write(
      "packages/features/example/server/src/ports/example-projection.port.ts",
      `
        export abstract class ExampleProjectionPort {
          abstract storeProjection(value: unknown): Promise<void>;
        }
      `,
    );
    write(
      "packages/features/example/server/src/services/example.service.ts",
      `
        import type { ExampleProjectionPort as Writer } from "../ports/example-projection.port";

        export class ExampleService {
          constructor(private readonly projection: Writer) {}
        }
      `,
    );

    expect(lint()).toMatchObject([
      {
        policy: "service-projection-write-boundary",
      },
    ]);
  });

  it("checks service properties and method parameters", () => {
    write(
      "packages/features/example/server/src/ports/example-projection.port.ts",
      `
        export abstract class ExampleProjectionPort {
          abstract storeProjectionBatch(values: unknown[]): Promise<void>;
        }
      `,
    );
    write(
      "packages/features/example/server/src/services/example.service.ts",
      `
        import type { FoldProjectionStore } from "@langwatch/eventing";
        import type { ExampleProjectionPort } from "../ports/example-projection.port";

        export class ExampleService {
          private readonly projection: FoldProjectionStore<unknown>;

          replay(projection: ExampleProjectionPort): void {
            void projection;
          }
        }
      `,
    );

    const violations = lint();

    expect(violations).toHaveLength(2);
    expect(violations.every(({ policy }) => policy === "service-projection-write-boundary")).toBe(
      true,
    );
  });

  it("accepts read-model ports and write stores owned by eventing roles", () => {
    write(
      "packages/features/example/server/src/ports/example-read-model.port.ts",
      `
        export abstract class ExampleReadModelPort {
          abstract getProjection(id: string): Promise<unknown>;
        }
      `,
    );
    write(
      "packages/features/example/server/src/services/example.service.ts",
      `
        import type { ExampleReadModelPort } from "../ports/example-read-model.port";

        export class ExampleService {
          constructor(private readonly readModel: ExampleReadModelPort) {}
        }
      `,
    );
    write(
      "packages/features/example/server/src/projections/example.projection.ts",
      `
        import type { FoldProjectionStore } from "@langwatch/eventing";

        export class ExampleProjection {
          constructor(private readonly store: FoldProjectionStore<unknown>) {}
        }
      `,
    );
    write(
      "packages/features/example/server/src/processes/example.process.ts",
      `
        import type { ProjectionStore } from "@langwatch/eventing";

        export class ExampleProcess {
          constructor(private readonly store: ProjectionStore<unknown>) {}
        }
      `,
    );

    expect(lint()).toEqual([]);
  });
});
