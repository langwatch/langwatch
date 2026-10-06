/**
 * Structural proof of the AuthZ feature boundary: its two packages, its two service capabilities
 * and where persistence may be reached from.
 * @see modules/authz/specs/package-boundary.feature
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import * as contract from "@langwatch/authz-contract";
import { describe, expect, it } from "vitest";

import { AuthzGrantsService } from "../services/authz-grants.service.ts";
import { AuthzService } from "../services/authz.service.ts";

const AUTHZ_ROOT = join(import.meta.dirname, "..", "..", "..");
const REPOSITORY_ROOT = join(AUTHZ_ROOT, "..", "..");
const PROCESS_SRC = join(AUTHZ_ROOT, "process", "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (entry === "__tests__" || entry === "node_modules") return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(path) ? [path] : [];
  });
}

function manifestOf(half: "contract" | "process") {
  return JSON.parse(readFileSync(join(AUTHZ_ROOT, half, "package.json"), "utf8")) as {
    name: string;
    dependencies?: Record<string, string>;
  };
}

describe("the AuthZ feature boundary", () => {
  describe("when the feature root is read", () => {
    /** @scenario "AuthZ has one versioned feature root" */
    it("holds a contract and a process package and no old package or forwarding name", () => {
      const names = [manifestOf("contract"), manifestOf("process")].flatMap((manifest) => [
        manifest.name,
        ...Object.keys(manifest.dependencies ?? {}),
      ]);

      expect(manifestOf("contract").name).toBe("@langwatch/authz-contract");
      expect(manifestOf("process").name).toBe("@langwatch/authz-process");
      expect(existsSync(join(REPOSITORY_ROOT, "packages", "authz"))).toBe(false);
      expect(existsSync(join(REPOSITORY_ROOT, "packages", "authz-server"))).toBe(false);
      expect(names).not.toContain("@langwatch/authz");
      expect(names).not.toContain("@langwatch/authz-server");
      expect(typeof contract.AuthzService).toBe("function");
      expect(typeof contract.AuthzGrantsService).toBe("function");
    });
  });

  describe("when a caller needs an Authorized witness", () => {
    /** @scenario "Authorization witnesses can only be minted by the service" */
    it("finds no witness-minting function among the contract's exports", () => {
      const minters = Object.entries(contract)
        .filter(([name, value]) => typeof value === "function" && /mint|witness/i.test(name))
        .map(([name]) => name);

      expect(minters).toEqual([]);
      expect(Object.keys(contract.AuthzService)).not.toContain("mintAuthorizationWitness");
    });
  });

  describe("when a runtime composes AuthZ", () => {
    /** @scenario "AuthZ exposes two service capabilities" */
    it("splits decisions and reads from grant mutations and offboarding, each with a static create", () => {
      const decisions = [
        "check",
        "authorize",
        "getScope",
        "listUserBindings",
        "getAccessBreakdown",
      ];
      const mutations = [
        "attachBindings",
        "defineRole",
        "createBinding",
        "offboardMember",
        "revoke",
      ];

      expect(typeof AuthzService.create).toBe("function");
      expect(typeof AuthzGrantsService.create).toBe("function");
      for (const name of decisions) {
        expect(Object.getOwnPropertyNames(AuthzService.prototype)).toContain(name);
        expect(Object.getOwnPropertyNames(AuthzGrantsService.prototype)).not.toContain(name);
      }
      for (const name of mutations) {
        expect(Object.getOwnPropertyNames(AuthzGrantsService.prototype)).toContain(name);
        expect(Object.getOwnPropertyNames(AuthzService.prototype)).not.toContain(name);
      }
    });

    it("exports no collector, listing, cache, gate or ledger service from the package root", () => {
      const index = readFileSync(join(PROCESS_SRC, "index.ts"), "utf8");
      const valueExports = [...index.matchAll(/^export \{[^}]*\} from "([^"]+)"/gm)].map(
        (match) => match[1]!,
      );

      expect(
        valueExports.filter((path) => /collector|listing|cache|gate|ledger/.test(path)),
      ).toEqual([]);
    });
  });

  describe("when AuthZ reads or writes authorization state", () => {
    /** @scenario "Persistence stays behind the server package" */
    it("declares abstract ports, reaches Prisma only below repositories/prisma and exports no Prisma type", () => {
      const repositories = join(PROCESS_SRC, "repositories");
      const ports = readdirSync(repositories).filter((file) =>
        /^authz-.*\.repository\.ts$/.test(file),
      );
      const notAbstract = ports.filter(
        (file) => !/export abstract class/.test(readFileSync(join(repositories, file), "utf8")),
      );
      const prismaReaders = sourceFiles(PROCESS_SRC)
        .filter((file) => /@prisma\/client|@langwatch\/prisma/.test(readFileSync(file, "utf8")))
        .filter((file) => !file.includes(join("repositories", "prisma")));
      const rootExports = readFileSync(join(PROCESS_SRC, "index.ts"), "utf8");
      const outsiders = sourceFiles(join(REPOSITORY_ROOT, "modules"))
        .concat(sourceFiles(join(REPOSITORY_ROOT, "enterprise", "modules")))
        .filter((file) => !file.startsWith(AUTHZ_ROOT))
        .filter((file) =>
          /@langwatch\/authz-process|authz\/process\/src\/repositories/.test(
            readFileSync(file, "utf8"),
          ),
        );

      expect(ports.length).toBeGreaterThan(0);
      expect(notAbstract).toEqual([]);
      expect(prismaReaders).toEqual([]);
      expect(rootExports).not.toMatch(/prisma/i);
      expect(outsiders).toEqual([]);
    });
  });
});
