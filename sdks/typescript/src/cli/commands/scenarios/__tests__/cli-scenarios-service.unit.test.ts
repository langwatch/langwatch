/**
 * A scenario save made from the command line has to be recorded as such.
 *
 * The platform reads the author of a version row from the surface header on
 * the request, so the write commands go through a client that declares it.
 * Without that header a command-line edit is recorded as an anonymous API
 * save, and the scenario's history says the wrong thing.
 *
 * Spec: specs/features/scenario-cli.feature
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const useSpy = vi.hoisted(() => vi.fn());
const putSpy = vi.hoisted(() => vi.fn());

vi.mock("@/internal/api/client", () => ({
  createLangWatchApiClient: vi.fn(() => ({ use: useSpy, PUT: putSpy })),
}));

vi.mock("../../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({
    apiKey: "test-key",
    source: "env",
    endpoint: "https://app.langwatch.ai",
  })),
}));

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
    warn: vi.fn(),
    text: "",
  }),
}));

import { createCliScenariosService } from "../cli-scenarios-service";
import { updateScenarioCommand } from "../update";
import { CLI_SURFACE_HEADER, CLI_SURFACE_VALUE } from "@/internal/surface";

const noop = () => {
  // intentionally empty, suppresses output during tests
};

/** The header the one registered middleware puts on a request. */
const surfaceHeaderOf = (call: unknown): string | null => {
  const middleware = call as {
    onRequest: (arg: { request: Request }) => Request;
  };
  const request = new Request(
    "https://app.langwatch.ai/api/scenarios/scenario_abc123",
    { method: "PUT" },
  );
  return middleware.onRequest({ request }).headers.get(CLI_SURFACE_HEADER);
};

describe("the scenarios service the command line writes through", () => {
  beforeEach(() => {
    useSpy.mockClear();
    putSpy.mockClear();
    putSpy.mockResolvedValue({
      data: {
        id: "scenario_abc123",
        name: "Updated Login Flow",
        situation: "User logs in",
        criteria: [],
        labels: [],
        parameters: [],
        testSuiteId: null,
      },
    });
    vi.spyOn(console, "log").mockImplementation(noop);
    vi.spyOn(console, "error").mockImplementation(noop);
  });

  /** @scenario "Updating a scenario from the command line records a new version" */
  it("declares the command line as the surface on every request", () => {
    createCliScenariosService();

    expect(useSpy).toHaveBeenCalledTimes(1);
    expect(surfaceHeaderOf(useSpy.mock.calls[0]![0])).toBe(CLI_SURFACE_VALUE);
  });

  /** @scenario "Updating a scenario from the command line records a new version" */
  it("is what the update command writes through", async () => {
    await updateScenarioCommand("scenario_abc123", {
      name: "Updated Login Flow",
    });

    expect(putSpy).toHaveBeenCalledWith("/api/scenarios/{id}", {
      params: { path: { id: "scenario_abc123" } },
      body: { name: "Updated Login Flow" },
    });
    expect(useSpy).toHaveBeenCalledTimes(1);
    expect(surfaceHeaderOf(useSpy.mock.calls[0]![0])).toBe(CLI_SURFACE_VALUE);
  });
});
