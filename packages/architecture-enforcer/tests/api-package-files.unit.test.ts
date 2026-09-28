import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const API_SOURCE = join(root, "packages/api/src");

/**
 * The whole source surface of `@langwatch/api`, named file by file. The legacy
 * builder family (and the 66 files only it reached) is gone: this IS the
 * package now, and the two assertions below hold it there in both directions.
 */
const TARGET_FILES = new Set([
  "index.ts",
  "access-policy.ts",
  "composition.ts",
  "dates.ts",
  "errors.ts",
  "handler-arguments.ts",
  "ports.ts",
  "schema.ts",
  "websocket.ts",
  // Raw HTTP and raw socket doors (record section 8).
  "raw-http.ts",
  "raw-socket.ts",
  "access/index.ts",
  "access/access.ts",
  "contract/index.ts",
  "contract/rest-middleware.ts",
  "contract/trpc-contract.ts",
  // Transport hosting: HTTP mux, API hosts and browser bundle (record section 4).
  "hosting/index.ts",
  "hosting/api-application.ts",
  "hosting/api-discovery.ts",
  "hosting/browser-bundle.ts",
  "hosting/framed-document.ts",
  "hosting/http-mux.ts",
  "hosting/openapi-document.ts",
  "hosting/transport-selection.ts",
  // Headers, CSP and client address.
  "policy/index.ts",
  "policy/client-address.ts",
  "policy/content-security-policy.ts",
  "policy/defaults.ts",
  "policy/security-headers.ts",
  // The transport files. Anything else under rest/ or trpc/ is a regression.
  "rest/index.ts",
  "rest/addressing.ts",
  "rest/bearer-identity.ts",
  "rest/browser-session.ts",
  "rest/byte-stream.ts",
  "rest/cli-token-identity.ts",
  "rest/credential.ts",
  "rest/declaration.ts",
  "rest/host.ts",
  "rest/idempotency.ts",
  "rest/openapi.ts",
  "rest/request.ts",
  "rest/response.ts",
  "rest/response-kind.ts",
  "rest/runtime.ts",
  "rest/security.ts",
  "rest/session-key-identity.ts",
  "rest/repositories/prisma/prisma.idempotency-receipt.ts",
  "trpc/index.ts",
  "trpc/audit.ts",
  "trpc/compose.ts",
  "trpc/host.ts",
  "trpc/policy.ts",
  "trpc/runtime.ts",
  "trpc/sse.ts",
  "trpc/throttle.ts",
  // The browser door, folded in from @langwatch/platform-api-client.
  "web/index.ts",
  "web/module-api.ts",
  "web/trpc-query-key.ts",
  "web/use-invalidate-procedure.ts",
]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(path);
    if (!entry.name.endsWith(".ts")) return [];
    if (/\.test(-d)?\.ts$/.test(entry.name)) return [];
    return [relative(API_SOURCE, path).split("\\").join("/")];
  });
}

describe("the @langwatch/api source surface", () => {
  const present = sourceFiles(API_SOURCE).toSorted();

  describe("when the package gains a source file", () => {
    /** @scenario "The api package accepts no new file outside the rebuild target" */
    it("refuses every file the layout does not name", () => {
      const additions = present.filter((file) => !TARGET_FILES.has(file));

      expect(additions).toEqual([]);
    });
  });

  describe("when the package loses a source file", () => {
    /** @scenario "The api package accepts no new file outside the rebuild target" */
    it("ratchets the layout down so a deleted file cannot come back", () => {
      const missing = [...TARGET_FILES].filter((file) => !present.includes(file)).toSorted();

      expect(missing).toEqual([]);
    });
  });
});
