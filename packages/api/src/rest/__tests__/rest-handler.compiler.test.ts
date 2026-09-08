import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

it("rejects values returned from a no-content governed REST handler", () => {
  const directory = mkdtempSync(join(process.cwd(), ".tmp-rest-handler-"));
  const fixture = join(directory, "fixture.ts");
  const definition = join(process.cwd(), "src/rest/definition.ts");

  writeFileSync(
    fixture,
    `import { z } from "zod";
import type { RestEndpoint } from ${JSON.stringify(definition)};

const input = z.object({});
const output = z.void();
declare const endpoint: RestEndpoint<object, typeof input, typeof output, true, true, true, false, true>;
endpoint.handle(() => ({ accidental: "body" }));
endpoint.handle(async () => { });
`,
  );

  try {
    let diagnostics = "";
    try {
      execFileSync(
        "pnpm",
        [
          "exec",
          "tsc",
          "--noEmit",
          "--pretty",
          "false",
          "--strict",
          "--skipLibCheck",
          "--target",
          "ESNext",
          "--module",
          "NodeNext",
          "--moduleResolution",
          "NodeNext",
          "--allowImportingTsExtensions",
          "--ignoreConfig",
          fixture,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      const processError = error as { stdout?: string; stderr?: string };
      diagnostics = `${processError.stdout ?? ""}${processError.stderr ?? ""}`;
    }

    expect(diagnostics).toMatch(/not assignable to type 'void \| Promise<void>'/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
