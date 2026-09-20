/**
 * A scenario reference is an id or a name; both are read the same way by
 * every scenario command.
 *
 * Spec: specs/features/scenario-cli.feature
 */
import { describe, it, expect, vi } from "vitest";
import type {
  ScenarioResponse,
  ScenariosApiService,
} from "@/client-sdk/services/scenarios";
import {
  resolveScenarioReference,
  ScenarioReferenceError,
} from "../resolveScenario";

const scenario = (
  overrides: Partial<ScenarioResponse> & Pick<ScenarioResponse, "id" | "name">,
): ScenarioResponse =>
  ({
    situation: "",
    criteria: [],
    labels: [],
    parameters: [],
    simulatorModel: null,
    judgeModel: null,
    maxTurns: null,
    minTurns: null,
    testSuiteId: null,
    platformUrl: null,
    ...overrides,
  }) as ScenarioResponse;

const serviceListing = (scenarios: ScenarioResponse[]): ScenariosApiService =>
  ({ getAll: vi.fn(async () => scenarios) }) as unknown as ScenariosApiService;

describe("resolveScenarioReference()", () => {
  describe("given scenarios with distinct names", () => {
    const service = serviceListing([
      scenario({ id: "scenario_1", name: "Login Flow" }),
      scenario({ id: "scenario_2", name: "Refund a paid order" }),
    ]);

    describe("when the reference is an id", () => {
      /** @scenario "Get scenario details by ID" */
      it("returns that scenario", async () => {
        const found = await resolveScenarioReference({
          reference: "scenario_2",
          service,
        });
        expect(found.name).toBe("Refund a paid order");
      });
    });

    describe("when the reference is an exact name", () => {
      /** @scenario "Get a scenario by its name" */
      it("returns that scenario", async () => {
        const found = await resolveScenarioReference({
          reference: "Login Flow",
          service,
        });
        expect(found.id).toBe("scenario_1");
      });
    });

    describe("when the reference differs from a name only by case", () => {
      /** @scenario "Get a scenario by its name ignoring case" */
      it("returns that scenario", async () => {
        const found = await resolveScenarioReference({
          reference: "refund A PAID order",
          service,
        });
        expect(found.id).toBe("scenario_2");
      });
    });

    describe("when the reference names nothing", () => {
      /** @scenario "A reference that names no scenario is not found" */
      it("refuses and points at the list command", async () => {
        await expect(
          resolveScenarioReference({ reference: "Checkout", service }),
        ).rejects.toThrow(ScenarioReferenceError);
        await expect(
          resolveScenarioReference({ reference: "Checkout", service }),
        ).rejects.toThrow("langwatch scenario list");
      });
    });
  });

  describe("given two scenarios that share a name", () => {
    const service = serviceListing([
      scenario({ id: "scenario_1", name: "Login Flow" }),
      scenario({ id: "scenario_2", name: "Login Flow" }),
      scenario({ id: "scenario_3", name: "login flow" }),
    ]);

    describe("when the reference is that name", () => {
      /** @scenario "A name two scenarios share is refused with both ids" */
      it("refuses with the ids of the exact matches", async () => {
        const failure = await resolveScenarioReference({
          reference: "Login Flow",
          service,
        }).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(ScenarioReferenceError);
        expect((failure as Error).message).toContain("scenario_1");
        expect((failure as Error).message).toContain("scenario_2");
        expect((failure as Error).message).not.toContain("scenario_3");
      });
    });

    describe("when the reference matches one name exactly", () => {
      /** @scenario "Get a scenario by its name" */
      it("prefers the exact match over the case-insensitive ones", async () => {
        const found = await resolveScenarioReference({
          reference: "login flow",
          service,
        });
        expect(found.id).toBe("scenario_3");
      });
    });
  });
});
