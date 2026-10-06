/**
 * The framework's two structural promises, read off the source rather than
 * asserted in a review: nothing under `src` reaches product, enterprise or
 * persistence code, and the Hono half never learns about the tRPC half.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { PermissionDecision } from "@langwatch/authorization";
import { defineTrpcContract, moduleApi } from "@langwatch/module";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { Authorize } from "../access/access.ts";
import type { TrpcAuditSink } from "../hosting/api-door.ts";
import { SessionReader } from "../hosting/session-reader.ts";
import { composeTrpcRouters } from "../trpc/compose.ts";
import { TrpcHost } from "../trpc/host.ts";
import { defineTrpcRouter } from "../trpc/runtime.ts";
import { createApiDouble } from "./api-double.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sourceRoot = join(packageRoot, "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);

    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function importSpecifiers(file: string): string[] {
  const source = readFileSync(file, "utf8");

  return [...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(
    (match) => match[1] ?? "",
  );
}

const FORBIDDEN_SPECIFIER = [
  { name: "the platform application", pattern: /^@langwatch\/(platform-api|ui|worker)(?:\/|$)/ },
  {
    name: "a product feature implementation",
    pattern: /^@langwatch\/[a-z-]+-(server|web)(?:\/|$)/,
  },
  { name: "enterprise code", pattern: /^@langwatch\/enterprise(?:-|\/|$)/ },
  { name: "Prisma", pattern: /^(@prisma\/|@langwatch\/prisma-client)/ },
];

describe("the @langwatch/api package boundary", () => {
  const files = sourceFiles(sourceRoot).filter(
    (file) => !/(^|\/)__tests__(\/|$)|\.test\.tsx?$/.test(file),
  );

  describe("given every source file in the package", () => {
    /** @scenario "The package owns the framework and nothing else" */
    it("imports no platform application, product feature, enterprise or Prisma module", () => {
      expect(files.length).toBeGreaterThan(0);

      const offences = files.flatMap((file) =>
        importSpecifiers(file).flatMap((specifier) =>
          FORBIDDEN_SPECIFIER.filter(({ pattern }) => pattern.test(specifier)).map(
            ({ name }) => `${file.slice(packageRoot.length + 1)} imports ${name}: ${specifier}`,
          ),
        ),
      );

      expect(offences).toEqual([]);
    });

    /** @scenario "The package owns the framework and nothing else" */
    it("declares only portable contracts among its first-party runtime dependencies", () => {
      const manifest = JSON.parse(
        readFileSync(join(packageRoot, "package.json"), "utf8"),
      ) as Record<string, Record<string, string>>;

      const firstParty = Object.keys(manifest.dependencies ?? {}).filter((name) =>
        name.startsWith("@langwatch/"),
      );

      expect(firstParty.length).toBeGreaterThan(0);

      expect(
        firstParty.filter((name) => /-(server|web)$/.test(name) || name.includes("enterprise")),
      ).toEqual([]);
    });
  });

  describe("given the Hono half of the framework", () => {
    /** @scenario "tRPC remains a separate transport" */
    it("never reaches the tRPC root, so it can neither mount nor document it", () => {
      const restFiles = files.filter((file) => file.includes(`${join("src", "rest")}`));
      expect(restFiles.length).toBeGreaterThan(0);

      const offences = restFiles.flatMap((file) =>
        importSpecifiers(file)
          .filter(
            (specifier) => specifier.startsWith("@trpc") || /(^|\/)trpc(\/|$)/.test(specifier),
          )
          .map((specifier) => `${file.slice(packageRoot.length + 1)} imports ${specifier}`),
      );

      expect(offences).toEqual([]);
    });

    /** @scenario "tRPC remains a separate transport" */
    it("keeps the tRPC half free of the routing and documentation libraries", () => {
      const trpcFiles = files.filter((file) => file.includes(`${join("src", "trpc")}`));
      expect(trpcFiles.length).toBeGreaterThan(0);

      const offences = trpcFiles.flatMap((file) =>
        importSpecifiers(file)
          .filter((specifier) => specifier === "hono" || specifier.startsWith("hono-openapi"))
          .map((specifier) => `${file.slice(packageRoot.length + 1)} imports ${specifier}`),
      );

      expect(offences).toEqual([]);
    });
  });

  describe("given a mutation that changes authorization facts", () => {
    const AUTHZ_RUNTIME_SPECIFIER =
      /^@langwatch\/authz-(process|contract|browser)(?:\/|$)|grants?-ledger|^@langwatch\/[a-z-]*grants?(?:\/|$)/;
    const PRISMA_SPECIFIER = /^(@prisma\/|@langwatch\/prisma-client)/;

    interface GrantApi {
      attach(input: { projectId: string }): Promise<{ attached: boolean }>;
    }

    const GrantApi = moduleApi<GrantApi>()("authz");

    function grantRouter() {
      return defineTrpcRouter(
        GrantApi,
        defineTrpcContract("grants")
          .mutation("attach")
          .withInput(z.object({ projectId: z.string() }))
          .withOutput(z.object({ attached: z.boolean() }))
          .build(),
      )
        .procedure("attach")
        .withPermission("organization:manage", { via: "projectId" })
        .handle(({ app, input }) => app.attach(input))
        .build();
    }

    async function attachThrough(audit: TrpcAuditSink | undefined) {
      const authz = createApiDouble<Authorize>({
        getDecision: async (): Promise<PermissionDecision> => ({
          permitted: true,
          organizationRole: "ADMIN",
        }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
      });
      const trpc = TrpcHost.create({
        sessions: SessionReader.create({ verify: async () => ({ userId: "sam" }) }),
        authz,
        ...(audit ? { audit } : {}),
        logger: { warn: () => {}, error: () => {} },
      });
      const application: GrantApi = { attach: async () => ({ attached: true }) };
      trpc.mount(composeTrpcRouters("grants", [grantRouter()]), () => application);

      const request = new Request(`http://api.test${TrpcHost.path}/grants.attach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: "project-1" }),
      });
      const response = await fetchRequestHandler({
        endpoint: TrpcHost.path,
        req: request,
        router: trpc.router,
        createContext: () => trpc.context({ request }),
      });

      return (await response.json()) as { result?: { data?: unknown } };
    }

    /** @scenario "The authorization engine and ledger remain application-owned" */
    it("imports no authz runtime, grants ledger or Prisma, and names no engine cutover", () => {
      const offences = files.flatMap((file) =>
        importSpecifiers(file)
          .filter(
            (specifier) =>
              AUTHZ_RUNTIME_SPECIFIER.test(specifier) || PRISMA_SPECIFIER.test(specifier),
          )
          .map((specifier) => `${file.slice(packageRoot.length + 1)} imports ${specifier}`),
      );
      const cutoverNames = files.filter((file) =>
        /cutover|isOnEngine|AUTHZ_ENGINE_MIGRATION/.test(readFileSync(file, "utf8")),
      );

      expect(offences).toEqual([]);
      expect(cutoverNames.map((file) => file.slice(packageRoot.length + 1))).toEqual([]);
    });

    /** @scenario "The authorization engine and ledger remain application-owned" */
    it("emits its audit row only through the sink the application installed", async () => {
      const rows: Parameters<TrpcAuditSink["record"]>[0][] = [];

      const answered = await attachThrough({ record: (entry) => void rows.push(entry) });
      const unrecorded = await attachThrough(void 0);

      expect(answered.result?.data).toEqual({ attached: true });
      expect(rows).toEqual([expect.objectContaining({ userId: "sam", action: "grants.attach" })]);
      expect(unrecorded.result?.data).toEqual({ attached: true });
      expect(rows).toHaveLength(1);
    });
  });
});
