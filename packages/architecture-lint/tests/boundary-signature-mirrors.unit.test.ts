import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { lintBoundarySignatureMirrors } from "../src/boundary-signature-mirrors.ts";

let root = "";

function write(path: string, source: string): void {
  const file = join(root, path);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, source);
}

function findings() {
  return lintBoundarySignatureMirrors(root);
}

describe("boundary signature mirrors", () => {
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  it("rejects global signature utility types in a core contract", () => {
    root = mkdtempSync(join(tmpdir(), "boundary-signatures-"));
    write(
      "packages/features/trace/contract/src/trace.api.ts",
      "type Input = Parameters<typeof create>[0];\nexport {};\n",
    );

    expect(findings()).toMatchObject([
      expect.objectContaining({
        policy: "boundary-signature-mirrors",
        file: expect.stringContaining("packages/features/trace/contract/src/trace.api.ts"),
        line: 1,
      }),
    ]);
  });

  it("rejects ReturnType and ConstructorParameters in an Enterprise server app", () => {
    root = mkdtempSync(join(tmpdir(), "boundary-signatures-"));
    write(
      "packages/enterprise/features/billing/server/src/app/billing.app.ts",
      "type Output = ReturnType<typeof build>;\ntype Args = ConstructorParameters<typeof Billing>;\n",
    );

    expect(findings()).toHaveLength(2);
  });

  it("rejects nested unknown and any assertions in application composition", () => {
    root = mkdtempSync(join(tmpdir(), "boundary-signatures-"));
    write(
      "apps/api/src/billing.composition.ts",
      "const one = value as unknown as Output;\nconst two = (value as any) as Output;\n",
    );

    expect(findings()).toHaveLength(2);
  });

  it("handles parentheses around a nested assertion", () => {
    root = mkdtempSync(join(tmpdir(), "boundary-signatures-"));
    write(
      "apps/worker/src/billing.composition.ts",
      "const one = ((value as unknown)) as Output;\nconst two = <string><unknown>42;\nconst three = 42 as (unknown) as string;\n",
    );

    expect(findings()).toHaveLength(3);
  });

  it("does not inspect comments or strings", () => {
    root = mkdtempSync(join(tmpdir(), "boundary-signatures-"));
    write(
      "packages/features/trace/contract/src/comments.ts",
      '// ReturnType<typeof create> and value as unknown as Output\nconst text = "Parameters<Foo>";\n',
    );

    expect(findings()).toEqual([]);
  });

  it("allows technical Parameters usage outside a boundary", () => {
    root = mkdtempSync(join(tmpdir(), "boundary-signatures-"));
    write(
      "packages/features/trace/server/src/services/trace.service.ts",
      "type Input = Parameters<typeof create>[0];\n",
    );

    expect(findings()).toEqual([]);
  });

  it("does not flag local or imported names that shadow global utility types", () => {
    root = mkdtempSync(join(tmpdir(), "boundary-signatures-"));
    write(
      "packages/features/trace/contract/src/shadowed.ts",
      'import type { ReturnType } from "./types.ts";\ntype Parameters<T> = T;\ntype A = ReturnType<Foo>;\ntype B = Parameters<Foo>;\n',
    );

    expect(findings()).toEqual([]);
  });

  it("keeps lexical type shadowing local to its declaration", () => {
    root = mkdtempSync(join(tmpdir(), "boundary-signatures-"));
    write(
      "packages/features/trace/contract/src/lexical.ts",
      "type Local<ReturnType> = ReturnType;\nexport type Leak = ReturnType<() => string>;\n",
    );

    expect(findings()).toHaveLength(1);
  });

  it("does not let a value-only binding shadow a global type utility", () => {
    root = mkdtempSync(join(tmpdir(), "boundary-signatures-"));
    write(
      "packages/features/trace/contract/src/value-binding.ts",
      "const Parameters = 1;\ntype Leak = Parameters<() => string>;\n",
    );

    expect(findings()).toHaveLength(1);
  });

  it("allows a generic utility name within its own type parameter scope", () => {
    root = mkdtempSync(join(tmpdir(), "boundary-signatures-"));
    write(
      "packages/features/trace/contract/src/generic.ts",
      "type Local<ReturnType> = ReturnType;\n",
    );

    expect(findings()).toEqual([]);
  });

  it("ignores tests and generated boundary files", () => {
    root = mkdtempSync(join(tmpdir(), "boundary-signatures-"));
    const source = "type A = ReturnType<typeof create>;\nconst b = value as unknown as Output;\n";
    write("packages/features/trace/contract/src/__tests__/trace.test.ts", source);
    write("packages/features/trace/contract/src/generated/trace.ts", source);

    expect(findings()).toEqual([]);
  });

  it("only scans the named application composition roots", () => {
    root = mkdtempSync(join(tmpdir(), "boundary-signatures-"));
    write("apps/ui/src/ui.composition.ts", "type A = ReturnType<typeof create>;\n");
    write("apps/api/src/transport.ts", "type B = ReturnType<typeof create>;\n");

    expect(findings()).toEqual([]);
  });
});
