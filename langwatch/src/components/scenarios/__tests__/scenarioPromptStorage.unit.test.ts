/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeStoredPrompt,
  SCENARIO_AI_PROMPT_KEY,
  storePromptForScenario,
} from "../services/scenarioPromptStorage";

describe("storePromptForScenario()", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it("stores prompt in sessionStorage with correct key", () => {
    storePromptForScenario("My prompt");

    expect(sessionStorage.getItem(SCENARIO_AI_PROMPT_KEY)).toBe("My prompt");
  });

  it("overwrites existing prompt", () => {
    storePromptForScenario("First prompt");
    storePromptForScenario("Second prompt");

    expect(sessionStorage.getItem(SCENARIO_AI_PROMPT_KEY)).toBe("Second prompt");
  });

  it("stores empty string", () => {
    storePromptForScenario("");

    expect(sessionStorage.getItem(SCENARIO_AI_PROMPT_KEY)).toBe("");
  });
});

describe("consumeStoredPrompt()", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it("returns stored prompt", () => {
    sessionStorage.setItem(SCENARIO_AI_PROMPT_KEY, "My prompt");

    const result = consumeStoredPrompt();

    expect(result).toBe("My prompt");
  });

  it("clears sessionStorage after consumption", () => {
    sessionStorage.setItem(SCENARIO_AI_PROMPT_KEY, "My prompt");

    consumeStoredPrompt();

    expect(sessionStorage.getItem(SCENARIO_AI_PROMPT_KEY)).toBeNull();
  });

  it("returns null when no prompt exists", () => {
    const result = consumeStoredPrompt();

    expect(result).toBeNull();
  });

  it("returns null for empty string", () => {
    sessionStorage.setItem(SCENARIO_AI_PROMPT_KEY, "");

    const result = consumeStoredPrompt();

    expect(result).toBeNull();
  });

  describe("when sessionStorage throws", () => {
    it("returns null gracefully", () => {
      const originalGetItem = sessionStorage.getItem;
      sessionStorage.getItem = vi.fn(() => {
        throw new Error("sessionStorage disabled");
      });

      const result = consumeStoredPrompt();

      expect(result).toBeNull();
      sessionStorage.getItem = originalGetItem;
    });
  });
});
