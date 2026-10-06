/**
 * @vitest-environment node
 * What the worker hands its preamble when started in development on a port the environment file
 * does not name.
 * @see specs/auth/dev-port-origin-alignment.feature
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  process.env.PORT = "5620";
  process.env.BASE_HOST = "http://localhost:5560";
  process.env.NEXTAUTH_URL = "http://localhost:5560";
  process.env.LANGWATCH_ENDPOINT = "http://localhost:5560";
});

import { processEnvironment } from "../config.ts";

describe("the worker's process environment", () => {
  describe("given a development start whose environment file names the committed port", () => {
    /** @scenario "The address the app checks against follows the port it was started on" */
    it("names the port it was started on for sign-in and for the identity layer", () => {
      expect(processEnvironment.BASE_HOST).toBe("http://localhost:5620");
      expect(processEnvironment.NEXTAUTH_URL).toBe("http://localhost:5620");
    });

    /** @scenario "The address handed to the agent worker follows the port the app was started on" */
    it("names the port it was started on for the agent worker's callback", () => {
      expect(processEnvironment.LANGWATCH_ENDPOINT).toBe("http://localhost:5620");
    });
  });
});
