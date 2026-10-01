/**
 * @vitest-environment jsdom
 * The personal budget chip reads the wire budget coerced at the hook boundary:
 * decimal strings become numbers and a bare "ok" carries no snapshot.
 */
import type { UserPersonalBudget } from "@langwatch/user-contract";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { answers } = vi.hoisted(() => {
  const answers = new Map<string, unknown>();
  return { answers };
});

vi.mock("../personal-workspace-api.ts", () => {
  const procedure = (path: string[]): unknown =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          if (property === "useQuery") {
            return () => ({ data: answers.get(path.join(".")), isSuccess: false });
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

import { usePersonalContext } from "../use-personal-context.ts";

function budgetFor(answer: UserPersonalBudget | undefined) {
  answers.set("user.personalBudget", answer);
  return renderHook(() => usePersonalContext()).result.current.budget;
}

describe("usePersonalContext budget", () => {
  afterEach(() => answers.clear());

  describe("when the budget has not answered", () => {
    it("reads as a bare ok", () => {
      expect(budgetFor(undefined)).toEqual({ status: "ok" });
    });
  });

  describe("when no budget applies", () => {
    it("reads as a bare ok", () => {
      expect(budgetFor({ status: "ok" })).toEqual({ status: "ok" });
    });
  });

  describe("when a budget applies", () => {
    it("coerces the decimal strings and carries every detail", () => {
      expect(
        budgetFor({
          status: "warning",
          scope: "team",
          spentUsd: "12.5",
          limitUsd: "20",
          period: "monthly",
          requestIncreaseUrl: "https://app.example/increase",
          adminEmail: "admin@acme.dev",
        }),
      ).toEqual({
        status: "warning",
        spentUsd: 12.5,
        limitUsd: 20,
        period: "monthly",
        scope: "team",
        requestIncreaseUrl: "https://app.example/increase",
        adminEmail: "admin@acme.dev",
      });
    });

    it("reads an absent increase link and admin as null", () => {
      expect(
        budgetFor({
          status: "exceeded",
          scope: "",
          spentUsd: "30",
          limitUsd: "20",
          period: "",
          adminEmail: null,
        }),
      ).toMatchObject({ requestIncreaseUrl: null, adminEmail: null, period: "", scope: "" });
    });
  });
});
