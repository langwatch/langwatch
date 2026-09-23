import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  generate,
  parse,
  getEnvironment,
  setEnvironment,
  getInstance,
  setInstance,
  Ksuid,
  Instance,
} from "../index.ts";

describe("Main API", () => {
  beforeEach(() => {
    // Reset environment to default
    setEnvironment("prod");
  });

  describe("generate()", () => {
    it("generates a valid KSUID", () => {
      const ksuid = generate("user");

      expect(ksuid).toBeInstanceOf(Ksuid);
      expect(ksuid.resource).toBe("user");
      expect(ksuid.environment).toBe("prod");
      expect(ksuid.toString()).toMatch(/^user_[A-Za-z0-9]{29}$/);
    });

    it("generates KSUID with custom environment", () => {
      setEnvironment("dev");
      const ksuid = generate("user");

      expect(ksuid.environment).toBe("dev");
      expect(ksuid.toString()).toMatch(/^dev_user_[A-Za-z0-9]{29}$/);
    });

    it("throws an error for empty resource", () => {
      expect(() => {
        generate("");
      }).toThrow("resource must not be empty");
    });

    it("throws an error for non-string resource", () => {
      expect(() => {
        generate(123 as never);
      }).toThrow("resource must be a string");
    });

    it("generates unique KSUIDs", () => {
      const ksuid1 = generate("user");
      const ksuid2 = generate("user");

      expect(ksuid1.toString()).not.toBe(ksuid2.toString());
    });

    it("handles sequence IDs correctly", () => {
      // Mock Date.now to return the same timestamp
      const mockTime = 1234567890000;
      vi.spyOn(Date, "now").mockReturnValue(mockTime);

      const ksuid1 = generate("user");
      const ksuid2 = generate("user");
      const ksuid3 = generate("user");

      expect(ksuid1.sequenceId).toBe(0);
      expect(ksuid2.sequenceId).toBe(1);
      expect(ksuid3.sequenceId).toBe(2);

      vi.restoreAllMocks();
    });
  });

  describe("parse()", () => {
    /** @scenario "Generated identifiers stay prefixed and parse back" */
    it("parses a valid KSUID", () => {
      const original = generate("user");
      const parsed = parse(original.toString());

      expect(parsed).toBeInstanceOf(Ksuid);
      expect(parsed.environment).toBe(original.environment);
      expect(parsed.resource).toBe(original.resource);
      expect(parsed.timestamp).toBe(original.timestamp);
      expect(parsed.sequenceId).toBe(original.sequenceId);
    });

    it("parses KSUID with environment prefix", () => {
      setEnvironment("dev");
      const original = generate("user");
      const parsed = parse(original.toString());

      expect(parsed.environment).toBe("dev");
      expect(parsed.resource).toBe("user");
    });

    it("throws an error for invalid KSUID", () => {
      expect(() => {
        parse("invalid-ksuid");
      }).toThrow("ID is invalid");
    });

    it("throws an error for non-string input", () => {
      expect(() => {
        parse(123 as never);
      }).toThrow("Input must be a string");
    });
  });

  describe("when getting and setting environment", () => {
    it("gets and sets environment", () => {
      expect(getEnvironment()).toBe("prod");

      setEnvironment("dev");
      expect(getEnvironment()).toBe("dev");

      setEnvironment("staging");
      expect(getEnvironment()).toBe("staging");
    });

    it("throws an error for invalid environment", () => {
      expect(() => {
        setEnvironment("invalid-env!");
      }).toThrow("environment contains invalid characters");
    });

    it("accepts valid environment names", () => {
      const validEnvs = ["prod", "dev", "staging", "test", "local", "env1", "env2"];

      validEnvs.forEach((env) => {
        expect(() => {
          setEnvironment(env);
        }).not.toThrow();
        expect(getEnvironment()).toBe(env);
      });
    });
  });

  describe("when getting and setting instance", () => {
    it("gets and sets instance", () => {
      const currentInstance = getInstance();
      expect(currentInstance).toBeInstanceOf(Instance);

      const newInstance = new Instance(Instance.schemes.RANDOM, new Uint8Array(8).fill(2));
      setInstance(newInstance);

      expect(getInstance()).toBe(newInstance);
    });

    it("throws an error for invalid instance", () => {
      expect(() => {
        setInstance({} as never);
      }).toThrow("instance must be an instance of Instance");
    });
  });

  describe("when generating and parsing end to end", () => {
    it("generates and parses KSUIDs consistently", () => {
      const resources = ["user", "order", "product", "session"];

      resources.forEach((resource) => {
        const ksuid = generate(resource);
        const parsed = parse(ksuid.toString());

        expect(parsed.equals(ksuid)).toBe(true);
        expect(parsed.toJSON()).toEqual(ksuid.toJSON());
      });
    });

    it("handles different environments correctly", () => {
      const environments = ["dev", "staging", "test"];

      environments.forEach((env) => {
        setEnvironment(env);
        const ksuid = generate("user");

        expect(ksuid.environment).toBe(env);
        expect(ksuid.toString()).toMatch(new RegExp(`^${env}_user_[A-Za-z0-9]{29}$`));

        const parsed = parse(ksuid.toString());
        expect(parsed.environment).toBe(env);
      });
    });

    it("generates sortable KSUIDs", () => {
      const ksuids: Ksuid[] = [];

      // Generate multiple KSUIDs with small delays
      for (let i = 0; i < 5; i++) {
        ksuids.push(generate("user"));
        // Small delay to ensure different timestamps
        if (i < 4) {
          // Use a small delay to ensure different timestamps
          const start = Date.now();
          while (Date.now() - start < 1) {
            // Busy wait for 1ms
          }
        }
      }

      // Sort by string representation
      const sorted = [...ksuids].toSorted((a, b) => a.toString().localeCompare(b.toString()));

      // Should be sorted by timestamp (KSUIDs are naturally sortable)
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].timestamp).toBeGreaterThanOrEqual(sorted[i - 1].timestamp);
      }
    });
  });
});
