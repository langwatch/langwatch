import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  isRoutingHandleConflict,
  normalizeRoutingHandle,
  RESERVED_ROUTING_HANDLES,
  ROUTING_HANDLE_MAX_LENGTH,
  routingHandleProblem,
  sanitizeRoutingHandleInput,
} from "../routingHandle";

/** Reads a submitted handle the way the service does. */
const check = (input: string | null | undefined) =>
  routingHandleProblem(normalizeRoutingHandle(input));

/**
 * The provider family spellings the gateway reads as a model prefix, taken
 * from the Go source that defines them.
 *
 * A second hand-written copy of this list is exactly what the parity check
 * has to catch, so the test reads the real one. The map is a plain literal of
 * quoted keys, so a parse this small is enough, and the length assertion in
 * the test fails loudly if the shape ever stops matching.
 */
function gatewayProviderFamilies(): string[] {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
  const source = readFileSync(
    resolve(repoRoot, "services/aigateway/domain/provider.go"),
    "utf8",
  );
  const block =
    /var knownProviderFamilies = map\[string\]struct\{\}\{\n([\s\S]*?)\n\}/.exec(
      source,
    )?.[1];
  if (!block) {
    throw new Error(
      "knownProviderFamilies not found in services/aigateway/domain/provider.go",
    );
  }
  return [...block.matchAll(/"([^"]+)":/g)].map((match) => match[1]!);
}

describe("routing handle", () => {
  describe("when an operator typed a handle", () => {
    /** @scenario "A handle is stored lowercased" */
    it("stores it lowercased and trimmed", () => {
      expect(normalizeRoutingHandle("  MyRouter ")).toBe("myrouter");
      expect(check("MyRouter")).toBeNull();
    });

    it("accepts letters, numbers, hyphens and underscores", () => {
      for (const handle of ["eu", "eu-west-1", "team_a", "r2d2", "0main"]) {
        expect(check(handle)).toBeNull();
      }
    });
  });

  describe("when the operator is still typing", () => {
    it("keeps the field to what would be stored as written", () => {
      expect(sanitizeRoutingHandleInput("OpenRouter EU")).toBe("openroutereu");
      expect(sanitizeRoutingHandleInput("eu/west")).toBe("euwest");
      expect(sanitizeRoutingHandleInput("--leading")).toBe("leading");
      expect(sanitizeRoutingHandleInput("a".repeat(40))).toHaveLength(
        ROUTING_HANDLE_MAX_LENGTH,
      );
    });

    it("never leaves the field holding a handle the write would refuse", () => {
      for (const typed of ["OpenRouter EU", "My Router!", "eu/west", "_x"]) {
        const shown = sanitizeRoutingHandleInput(typed);
        if (shown === "") continue;
        expect(routingHandleProblem(shown)).not.toBe("shape");
      }
    });
  });

  describe("when the text is not a handle", () => {
    /** @scenario "A handle outside the allowed characters is refused" */
    it("refuses characters a model string cannot carry", () => {
      for (const handle of ["my router!", "eu/west", "-leading", "_leading"]) {
        expect(check(handle)).toBe("shape");
      }
    });

    /** @scenario "A handle longer than the limit is refused" */
    it("refuses a handle longer than the limit", () => {
      expect(check("a".repeat(32))).toBeNull();
      expect(check("a".repeat(33))).toBe("shape");
    });
  });

  describe("when the text already names a provider family", () => {
    /** @scenario "A handle that names a provider family is refused" */
    it("refuses a provider family key", () => {
      for (const handle of ["anthropic", "openai", "custom", "bedrock"]) {
        expect(check(handle)).toBe("reserved");
      }
    });

    /** @scenario "A handle that names a provider family alias is refused" */
    it("refuses the alternative spellings the gateway also accepts", () => {
      for (const handle of [
        "vertex_ai",
        "vertex",
        "google_vertex",
        "azure_openai",
        "aws_bedrock",
        "google_gemini",
      ]) {
        expect(check(handle)).toBe("reserved");
      }
    });

    it("refuses the application's own model wire prefix", () => {
      expect(check("mp")).toBe("reserved");
    });

    it("covers every provider family the gateway reads as a prefix", () => {
      // The gateway reads a handle BEFORE a provider family, so a family
      // spelling missing from this set would be shadowed for a whole
      // organization. The gateway owns that vocabulary in Go, so the check
      // reads its list rather than a copy that can drift from it.
      const families = gatewayProviderFamilies();
      expect(families.length).toBeGreaterThan(10);

      const unreserved = families.filter(
        (family) => !RESERVED_ROUTING_HANDLES.has(family),
      );
      expect(unreserved).toEqual([]);
    });
  });

  describe("when the handle is cleared", () => {
    /** @scenario "Clearing a handle releases the name" */
    it("reads every blank shape as no handle", () => {
      for (const input of [undefined, null, "", "   "]) {
        expect(normalizeRoutingHandle(input)).toBeNull();
        expect(check(input)).toBeNull();
      }
    });
  });

  describe("when the database refuses the write", () => {
    it("reads a routing-handle unique violation as a conflict", () => {
      expect(
        isRoutingHandleConflict({
          code: "P2002",
          meta: { target: ["organizationId", "routingHandle"] },
        }),
      ).toBe(true);
      expect(
        isRoutingHandleConflict({
          code: "P2002",
          meta: { target: "ModelProvider_organizationId_routingHandle_key" },
        }),
      ).toBe(true);
    });

    it("leaves another index's violation alone", () => {
      expect(
        isRoutingHandleConflict({
          code: "P2002",
          meta: { target: ["organizationId", "name"] },
        }),
      ).toBe(false);
      expect(isRoutingHandleConflict(new Error("boom"))).toBe(false);
      expect(isRoutingHandleConflict(null)).toBe(false);
    });
  });
});
