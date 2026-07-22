// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  traceDisplayName,
  useResolvedTraceName,
} from "../components/langyTraceName";

const capturedHeaderInputs: Array<{ full?: boolean }> = [];

vi.mock("~/utils/api", () => ({
  api: {
    tracesV2: {
      header: {
        useQuery: (input: { full?: boolean }) => {
          capturedHeaderInputs.push(input);
          return { data: undefined };
        },
      },
    },
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({ project: { id: "p1" } }),
}));

/**
 * The one trace display-name derivation for Langy's context surfaces (task #11).
 * It walks the same chain the app already uses — resolved trace name, then root
 * span name, then a shortened id — so a context chip reads like the trace drawer.
 */
describe("traceDisplayName", () => {
  describe("given a resolved trace name", () => {
    it("uses it verbatim", () => {
      expect(
        traceDisplayName({
          traceName: "Checkout agent run",
          name: "POST /chat",
          traceId: "abc123def456",
        }),
      ).toBe("Checkout agent run");
    });

    it("trims surrounding whitespace", () => {
      expect(
        traceDisplayName({
          traceName: "  Named run  ",
          name: null,
          traceId: "abc123def456",
        }),
      ).toBe("Named run");
    });
  });

  describe("given no resolved name but a root span name", () => {
    it("falls back to the span name", () => {
      expect(
        traceDisplayName({
          traceName: undefined,
          name: "POST /v1/chat",
          traceId: "abc123def456",
        }),
      ).toBe("POST /v1/chat");
    });

    it("ignores a span name that is just the trace id", () => {
      // A root-span name that is the id (or a prefix of it) is no better than
      // the id, so it is skipped — matching the drawer header's chain.
      expect(
        traceDisplayName({
          traceName: undefined,
          name: "abc123def456",
          traceId: "abc123def456",
        }),
      ).toBe("abc123…56");
    });
  });

  describe("given neither a resolved name nor a usable span name", () => {
    it("falls back to a shortened id, not the raw id", () => {
      const name = traceDisplayName({
        traceName: undefined,
        name: undefined,
        traceId: "abcdef1234567890",
      });
      expect(name).not.toBe("abcdef1234567890");
      expect(name).toContain("…");
    });
  });
});

describe("useResolvedTraceName", () => {
  describe("given a trace id with no cached label", () => {
    describe("when resolving the trace name", () => {
      it("reads only the name — never the extra spans read full IO resolution costs", () => {
        renderHook(() => useResolvedTraceName("trace-1"));

        expect(capturedHeaderInputs.at(-1)).toMatchObject({ full: false });
      });
    });
  });
});
