/**
 * @vitest-environment jsdom
 * Whether the personal home is in use, as the guided offer reads it: a failed read is unknown.
 * @see specs/home/guided-onboarding-offer.feature
 */
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

type Answer = { data: unknown; isError: boolean };

const { answers } = vi.hoisted(() => ({ answers: new Map<string, Answer>() }));

vi.mock("../personal-workspace-api.ts", () => {
  const procedure = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          if (property === "useQuery") {
            return () => answers.get(path.join(".")) ?? { data: undefined, isError: false };
          }
          return procedure([...path, property]);
        },
      },
    );
  return { api: procedure([]) };
});

vi.mock("../personal-workspace-session.ts", () => ({
  useCurrentUser: () => ({ id: "usr_1", email: "jane@acme.dev", name: "Jane" }),
  useOrganizationTeamProject: () => ({ organization: { id: "org_1", name: "ACME" } }),
}));

import { usePersonalSpaceInUse } from "../use-personal-space-in-use.ts";

const KEYS = "personalVirtualKeys.list";
const USAGE = "governance.personalUsage";
const unusedUsage = { data: { summary: { requests: 0 } }, isError: false };

const spaceInUse = () => renderHook(() => usePersonalSpaceInUse()).result.current;

describe("usePersonalSpaceInUse", () => {
  afterEach(() => answers.clear());

  describe("given the personal keys failed to load over an empty list still in the cache", () => {
    /** @scenario a read that failed is not read as an empty space */
    it("reads as unknown, not as an unused space", () => {
      answers.set(KEYS, { data: [], isError: true });
      answers.set(USAGE, unusedUsage);
      expect(spaceInUse()).toBeNull();
    });
  });

  describe("given the usage failed to load over an empty summary still in the cache", () => {
    /** @scenario a read that failed is not read as an empty space */
    it("reads as unknown, not as an unused space", () => {
      answers.set(KEYS, { data: [], isError: false });
      answers.set(USAGE, { ...unusedUsage, isError: true });
      expect(spaceInUse()).toBeNull();
    });
  });

  describe("given both reads answered with nothing", () => {
    it("reads as an unused space", () => {
      answers.set(KEYS, { data: [], isError: false });
      answers.set(USAGE, unusedUsage);
      expect(spaceInUse()).toBe(false);
    });
  });
});
