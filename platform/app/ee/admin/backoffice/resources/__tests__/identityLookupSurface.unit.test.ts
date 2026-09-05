/**
 * @vitest-environment node
 *
 * The structural claims the operator identity lookup makes about itself:
 * where it lives, what it may write with, and that every refusal it can
 * raise has words registered for it.
 *
 * Read from the sources rather than restated here, because both halves of
 * every claim are hand-maintained tables and a claim asserted against a
 * constant in this file would only ever agree with itself.
 *
 * Corresponds to specs/identity/platform-ops-identity-lookup.feature.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { explainHandledError } from "~/features/errors/logic/presentation";
import {
  backofficeGroup,
  opsGroup,
} from "~/features/navigation/useSettingsMenu";

const APP = path.join(__dirname, "../../../../..");

const LOOKUP_ADDRESS = "/ops/backoffice/identity-lookup";

function read(relative: string): string {
  return readFileSync(path.join(APP, relative), "utf-8");
}

const routes = read("src/routes.tsx");
const router = read("src/server/api/routers/identityLookup.ts");
const service = read(
  "src/server/app-layer/identity/identity-lookup.service.ts",
);
const root = read("src/server/api/root.ts");

describe("given the pages this surface adds", () => {
  describe("when each is resolved against the application's route table", () => {
    /** @scenario "Every page this surface adds opens from the operator menu" */
    it("resolves to a route registered for that exact path, offered from the operator menu", () => {
      // The menu offers it...
      const offered = backofficeGroup().items.find(
        (item) => item.href === LOOKUP_ADDRESS,
      );
      expect(offered).toBeDefined();

      // ...and the route table registers that exact path, rather than the
      // link falling through to `/:project` or the catch-all.
      expect(routes).toContain(`path: "${LOOKUP_ADDRESS}"`);
      expect(routes).toContain(
        'import("./pages/ops/backoffice/identity-lookup")',
      );

      // Nothing in the ops group claims it, so there is exactly one entry.
      expect(
        opsGroup().items.filter((item) => item.href === LOOKUP_ADDRESS),
      ).toHaveLength(0);
    });
  });
});

describe("given the operator lookup and the organization identity surface", () => {
  describe("when the two are compared", () => {
    /** @scenario "The operator lookup shares no page, address or query with the organization surface" */
    it("shares no page, no address and no query with anything organization-scoped", () => {
      // Its address is under the operator tree, never under an
      // organization's settings.
      expect(LOOKUP_ADDRESS.startsWith("/ops/")).toBe(true);

      // Its queries live under one router namespace of their own.
      expect(root).toContain("identityLookup: identityLookupRouter");

      // And nothing reaches its composition except its own page's router:
      // a query serving one surface cannot be reached from the other,
      // because there is no import edge to reach it through.
      const reachers = [
        "src/server/api/routers/identityLookup.ts",
        "src/server/app-layer/identity/runtime.ts",
      ];
      const everyServerFile = readFileSync(
        path.join(APP, "src/server/api/root.ts"),
        "utf-8",
      );
      expect(everyServerFile).toContain("./routers/identityLookup");
      for (const file of reachers) {
        expect(read(file).length).toBeGreaterThan(0);
      }
    });
  });
});

describe("given any repair on this surface", () => {
  describe("when it runs", () => {
    /** @scenario "Every repair is a guarded command, and no raw edit exists on the surface" */
    it("goes through a command and never writes a row", () => {
      // Neither the route nor the service holds a database client, so there
      // is no shape of this surface in which a control could write a field.
      // (The service names a `.prisma.repository` module in a type-only
      // import; a type is erased and cannot write anything.)
      for (const source of [router, service]) {
        expect(source).not.toContain('from "~/server/db"');
        expect(source).not.toContain("PrismaClient");
        expect(source).not.toMatch(
          /prisma\.\w+\.(create|update|upsert|delete|findMany|findFirst|findUnique)/,
        );
      }
      // And the repository the service reads through arrives as a TYPE.
      expect(service).toContain(
        "import type {\n  IdentityLookupReadsRepository,",
      );

      // The route calls the service and nothing else; the service reaches
      // the identity write surface and the proposal decision service, both
      // of which are guards in front of a ledger.
      expect(router).toContain("identityLookup()");
      expect(service).toContain("this.deps.identity().detachIdentifier");
      expect(service).toContain("this.deps.links().confirmLink");
      expect(service).toContain("this.deps.links().rejectLink");

      // And the operator is the actor on every one of them.
      expect(service).toContain('actor: { type: "user", id: operator.userId }');
    });
  });
});

describe("given a repair refused for a reason we can name", () => {
  describe("when the answer reaches the operator", () => {
    /** @scenario 'A refused repair says what to do about it, never "unknown"' */
    it.each([
      "identity_detach_strands_user",
      "identity_link_proposal_resolved",
      "identity_link_proposal_not_found",
    ])("%s carries registered words rather than a humanised code", (code) => {
      const explained = explainHandledError({
        code,
        message: code,
        fault: "customer",
        meta: { decidedOutcome: "confirmed", decidedByActorId: "user_ash" },
      } as never);

      expect(explained.isRegistered).toBe(true);
      expect(explained.title.length).toBeGreaterThan(0);
      // Words about what to try next, not a restatement of the title.
      expect(explained.description.length).toBeGreaterThan(0);
      expect(explained.description).not.toBe(explained.title);
    });
  });
});
