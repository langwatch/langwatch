import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { lintEnterpriseSourceLicense } from "../src/enterprise-source-license.ts";
import { snapshotOf } from "./workspace.ts";

let root = "";

function write(path: string, contents: string): void {
  const file = join(root, path);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, contents);
}

function violations(): ReturnType<typeof lintEnterpriseSourceLicense> {
  return lintEnterpriseSourceLicense(snapshotOf({ root }));
}

describe("Enterprise source license placement", () => {
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  it("reports a core feature source file with the Enterprise SPDX directive", () => {
    root = mkdtempSync(join(tmpdir(), "enterprise-license-"));
    write(
      "packages/features/trace/server/src/trace.ts",
      "// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise\nexport {};\n",
    );

    expect(violations()).toMatchObject([
      {
        policy: "enterprise-source-license",
        file: join(root, "packages/features/trace/server/src/trace.ts"),
        line: 1,
      },
    ]);
  });

  it("reports an application source file with the Enterprise SPDX directive", () => {
    root = mkdtempSync(join(tmpdir(), "enterprise-license-"));
    write(
      "apps/api/src/enterprise-route.ts",
      "/**\n * SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise\n */\nexport {};\n",
    );

    expect(violations()).toHaveLength(1);
    expect(violations()[0]?.line).toBe(2);
  });

  it("reports framework source outside the Enterprise aggregate", () => {
    root = mkdtempSync(join(tmpdir(), "enterprise-license-"));
    write(
      "packages/framework/src/runtime.ts",
      "/* SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise */\nexport {};\n",
    );

    expect(violations()).toHaveLength(1);
  });

  it.each(["mts", "cts", "js", "mjs"])("finds misplaced headers after imports in %s production files", (extension) => {
    root = mkdtempSync(join(tmpdir(), "enterprise-license-"));
    write(`packages/core/src/implementation.${extension}`, 'import "./dependency.js";\n// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise\nexport {};');
    expect(violations()).toEqual([expect.objectContaining({ policy: "enterprise-source-license", line: 2 })]);
  });

  it("does not mistake a string for a license directive", () => {
    root = mkdtempSync(join(tmpdir(), "enterprise-license-"));
    write("packages/core/src/implementation.ts", 'export const example = "// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise";');
    expect(violations()).toEqual([]);
  });

  it("finds a directive after an interpolated template literal", () => {
    root = mkdtempSync(join(tmpdir(), "enterprise-license-"));
    write("packages/core/src/implementation.ts", 'const message = `hello ${name}`;\n// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise\nexport {};');
    expect(violations()).toEqual([expect.objectContaining({ policy: "enterprise-source-license", line: 2 })]);
  });

  it("allows Enterprise source", () => {
    root = mkdtempSync(join(tmpdir(), "enterprise-license-"));
    write(
      "packages/enterprise/features/trace/server/src/trace.ts",
      "// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise\nexport {};\n",
    );

    expect(violations()).toEqual([]);
  });

  it("does not treat a comment mentioning the marker as an SPDX directive", () => {
    root = mkdtempSync(join(tmpdir(), "enterprise-license-"));
    write(
      "apps/api/src/comment.ts",
      "// This discusses SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise\nexport {};\n",
    );

    expect(violations()).toEqual([]);
  });

  it("ignores tests, fixtures, generated files, and declaration files", () => {
    root = mkdtempSync(join(tmpdir(), "enterprise-license-"));
    const marker = "// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise\nexport {};\n";
    write("apps/api/src/foo.test.ts", marker);
    write("apps/api/tests/foo.ts", marker);
    write("apps/api/fixtures/foo.ts", marker);
    write("apps/api/generated/foo.ts", marker);
    write("apps/api/src/foo.d.ts", marker);

    expect(violations()).toEqual([]);
  });
});
