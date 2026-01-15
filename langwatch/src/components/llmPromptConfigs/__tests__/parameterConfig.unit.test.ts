/**
 * Unit tests for parameter configuration
 */

import { describe, expect, it } from "vitest";
import type { ReasoningConfig } from "../../../server/modelProviders/llmModels.types";
import {
  DEFAULT_SUPPORTED_PARAMETERS,
  getDisplayParameters,
  getEffectiveParameterConfig,
  getParameterConfig,
  getParameterDefault,
  isReasoningParameter,
  PARAM_NAME_MAPPING,
  PARAMETER_CONFIG,
  PARAMETER_DISPLAY_ORDER,
  supportsReasoning,
  supportsTemperature,
  toFormKey,
  toInternalKey,
} from "../parameterConfig";

describe("Parameter Config", () => {
  describe("PARAMETER_CONFIG", () => {
    it("has temperature config", () => {
      const config = PARAMETER_CONFIG.temperature;
      expect(config).toBeDefined();
      expect(config?.type).toBe("slider");
    });

    it("has max_tokens config with dynamic max", () => {
      const config = PARAMETER_CONFIG.max_tokens;
      expect(config).toBeDefined();
      expect(config?.type).toBe("slider");
      if (config?.type === "slider") {
        expect(config.dynamicMax).toBe(true);
      }
    });

    it("has reasoning_effort config as select", () => {
      const config = PARAMETER_CONFIG.reasoning_effort;
      expect(config).toBeDefined();
      expect(config?.type).toBe("select");
      if (config?.type === "select") {
        expect(config.options).toContain("low");
        expect(config.options).toContain("medium");
        expect(config.options).toContain("high");
      }
    });

    it("has frequency_penalty config", () => {
      const config = PARAMETER_CONFIG.frequency_penalty;
      expect(config).toBeDefined();
      expect(config?.type).toBe("slider");
    });

    it("has presence_penalty config", () => {
      const config = PARAMETER_CONFIG.presence_penalty;
      expect(config).toBeDefined();
      expect(config?.type).toBe("slider");
    });

    it("has top_p config", () => {
      const config = PARAMETER_CONFIG.top_p;
      expect(config).toBeDefined();
      expect(config?.type).toBe("slider");
    });
  });

  describe("getParameterConfig", () => {
    it("returns config for known parameter", () => {
      const config = getParameterConfig("temperature");
      expect(config).toBeDefined();
      expect(config?.label).toBe("Temperature");
    });

    it("returns undefined for unknown parameter", () => {
      const config = getParameterConfig("unknown_param");
      expect(config).toBeUndefined();
    });
  });

  describe("getDisplayParameters", () => {
    it("returns default parameters for empty array", () => {
      const params = getDisplayParameters([]);
      expect(params).toEqual(DEFAULT_SUPPORTED_PARAMETERS);
    });

    it("filters to only configured parameters", () => {
      const params = getDisplayParameters([
        "temperature",
        "unknown_param",
        "max_tokens",
      ]);
      expect(params).toContain("temperature");
      expect(params).toContain("max_tokens");
      expect(params).not.toContain("unknown_param");
    });

    it("sorts parameters by display order", () => {
      const params = getDisplayParameters([
        "max_tokens",
        "temperature",
        "reasoning_effort",
      ]);
      // reasoning_effort should come before temperature in display order
      expect(params.indexOf("reasoning_effort")).toBeLessThan(
        params.indexOf("temperature"),
      );
      expect(params.indexOf("temperature")).toBeLessThan(
        params.indexOf("max_tokens"),
      );
    });

    it("handles GPT-4.1 style parameters", () => {
      const params = getDisplayParameters([
        "temperature",
        "top_p",
        "max_tokens",
        "frequency_penalty",
        "presence_penalty",
      ]);
      expect(params).toContain("temperature");
      expect(params).toContain("top_p");
      expect(params).toContain("frequency_penalty");
      expect(params).toContain("presence_penalty");
    });

    it("handles GPT-5 style parameters", () => {
      const params = getDisplayParameters([
        "reasoning",
        "max_tokens",
        "seed",
        "tool_choice",
      ]);
      expect(params).toContain("reasoning");
      expect(params).toContain("max_tokens");
      expect(params).toContain("seed");
      expect(params).not.toContain("tool_choice"); // Not in our config
    });
  });

  describe("getParameterDefault", () => {
    it("returns default for temperature", () => {
      expect(getParameterDefault("temperature")).toBe(1);
    });

    it("returns default for max_tokens", () => {
      expect(getParameterDefault("max_tokens")).toBe(4096);
    });

    it("returns default for reasoning_effort", () => {
      expect(getParameterDefault("reasoning_effort")).toBe("medium");
    });

    it("returns undefined for unknown parameter", () => {
      expect(getParameterDefault("unknown_param")).toBeUndefined();
    });
  });

  describe("isReasoningParameter", () => {
    it("returns true for reasoning_effort", () => {
      expect(isReasoningParameter("reasoning_effort")).toBe(true);
    });

    it("returns true for reasoning", () => {
      expect(isReasoningParameter("reasoning")).toBe(true);
    });

    it("returns true for verbosity", () => {
      expect(isReasoningParameter("verbosity")).toBe(true);
    });

    it("returns false for temperature", () => {
      expect(isReasoningParameter("temperature")).toBe(false);
    });
  });

  describe("supportsTemperature", () => {
    it("returns true when temperature is in supported params", () => {
      expect(supportsTemperature(["temperature", "max_tokens"])).toBe(true);
    });

    it("returns false when temperature is not in supported params", () => {
      expect(supportsTemperature(["reasoning", "max_tokens"])).toBe(false);
    });
  });

  describe("supportsReasoning", () => {
    it("returns true when reasoning is supported", () => {
      expect(supportsReasoning(["reasoning", "max_tokens"])).toBe(true);
    });

    it("returns true when reasoning_effort is supported", () => {
      expect(supportsReasoning(["reasoning_effort", "max_tokens"])).toBe(true);
    });

    it("returns false when no reasoning params supported", () => {
      expect(supportsReasoning(["temperature", "max_tokens"])).toBe(false);
    });
  });

  describe("DEFAULT_SUPPORTED_PARAMETERS", () => {
    it("includes temperature", () => {
      expect(DEFAULT_SUPPORTED_PARAMETERS).toContain("temperature");
    });

    it("includes max_tokens", () => {
      expect(DEFAULT_SUPPORTED_PARAMETERS).toContain("max_tokens");
    });
  });

  describe("PARAMETER_DISPLAY_ORDER", () => {
    it("has reasoning params first", () => {
      expect(PARAMETER_DISPLAY_ORDER.indexOf("reasoning_effort")).toBeLessThan(
        PARAMETER_DISPLAY_ORDER.indexOf("temperature"),
      );
    });

    it("has traditional params in logical order", () => {
      expect(PARAMETER_DISPLAY_ORDER.indexOf("temperature")).toBeLessThan(
        PARAMETER_DISPLAY_ORDER.indexOf("max_tokens"),
      );
    });
  });

  describe("getEffectiveParameterConfig", () => {
    it("returns base config when no reasoningConfig provided", () => {
      const config = getEffectiveParameterConfig("temperature");
      expect(config?.type).toBe("slider");
    });

    it("returns base config for non-reasoning parameters even with reasoningConfig", () => {
      const reasoningConfig: ReasoningConfig = {
        supported: true,
        parameterName: "reasoning_effort",
        allowedValues: ["low", "medium", "high"],
        defaultValue: "medium",
        canDisable: false,
      };
      const config = getEffectiveParameterConfig(
        "temperature",
        reasoningConfig,
      );
      expect(config?.type).toBe("slider");
    });

    it("uses model reasoningConfig for reasoning_effort options", () => {
      const reasoningConfig: ReasoningConfig = {
        supported: true,
        parameterName: "reasoning_effort",
        allowedValues: ["low", "high"],
        defaultValue: "high",
        canDisable: false,
      };
      const config = getEffectiveParameterConfig(
        "reasoning_effort",
        reasoningConfig,
      );

      expect(config?.type).toBe("select");
      if (config?.type === "select") {
        expect(config.options).toEqual(["low", "high"]);
        expect(config.default).toBe("high");
      }
    });

    it("uses model reasoningConfig for reasoning options", () => {
      const reasoningConfig: ReasoningConfig = {
        supported: true,
        parameterName: "reasoning",
        allowedValues: ["none", "low", "medium", "high", "xhigh"],
        defaultValue: "none",
        canDisable: true,
      };
      const config = getEffectiveParameterConfig("reasoning", reasoningConfig);

      expect(config?.type).toBe("select");
      if (config?.type === "select") {
        expect(config.options).toEqual([
          "none",
          "low",
          "medium",
          "high",
          "xhigh",
        ]);
        expect(config.default).toBe("none");
      }
    });

    it("returns fallback options when no reasoningConfig", () => {
      const config = getEffectiveParameterConfig("reasoning_effort");

      expect(config?.type).toBe("select");
      if (config?.type === "select") {
        // Should have fallback options
        expect(config.options).toContain("low");
        expect(config.options).toContain("medium");
        expect(config.options).toContain("high");
      }
    });
  });

  describe("PARAM_NAME_MAPPING", () => {
    it("maps top_p to topP", () => {
      expect(PARAM_NAME_MAPPING.top_p).toBe("topP");
    });

    it("maps frequency_penalty to frequencyPenalty", () => {
      expect(PARAM_NAME_MAPPING.frequency_penalty).toBe("frequencyPenalty");
    });

    it("maps reasoning_effort to reasoningEffort", () => {
      expect(PARAM_NAME_MAPPING.reasoning_effort).toBe("reasoningEffort");
    });
  });

  describe("toFormKey", () => {
    it("converts snake_case to camelCase", () => {
      expect(toFormKey("top_p")).toBe("topP");
      expect(toFormKey("frequency_penalty")).toBe("frequencyPenalty");
      expect(toFormKey("reasoning_effort")).toBe("reasoningEffort");
    });

    it("returns same key for non-mapped params", () => {
      expect(toFormKey("temperature")).toBe("temperature");
      expect(toFormKey("reasoning")).toBe("reasoning");
      expect(toFormKey("seed")).toBe("seed");
    });
  });

  describe("toInternalKey", () => {
    it("converts camelCase to snake_case", () => {
      expect(toInternalKey("topP")).toBe("top_p");
      expect(toInternalKey("frequencyPenalty")).toBe("frequency_penalty");
      expect(toInternalKey("reasoningEffort")).toBe("reasoning_effort");
    });

    it("returns same key for non-mapped params", () => {
      expect(toInternalKey("temperature")).toBe("temperature");
      expect(toInternalKey("reasoning")).toBe("reasoning");
      expect(toInternalKey("seed")).toBe("seed");
    });
  });

  describe("reasoning options fallback", () => {
    it("does not include none in reasoning_effort fallback options", () => {
      const config = PARAMETER_CONFIG.reasoning_effort;
      expect(config?.type).toBe("select");
      if (config?.type === "select") {
        expect(config.options).not.toContain("none");
      }
    });

    it("does not include none in reasoning fallback options", () => {
      const config = PARAMETER_CONFIG.reasoning;
      expect(config?.type).toBe("select");
      if (config?.type === "select") {
        expect(config.options).not.toContain("none");
      }
    });
  });
});
