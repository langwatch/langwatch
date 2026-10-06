import { describe, expect, it } from "vitest";

import { alignDevAuthUrlsToPort } from "../dev-port-alignment.ts";

const align = (environment: Record<string, string | undefined>) =>
  alignDevAuthUrlsToPort({ environment });

describe("given a development process on a non-default port", () => {
  describe("when the configured addresses name the committed default port", () => {
    /** @scenario "The address the app checks against follows the port it was started on" */
    it("realigns the sign-in address and the identity-layer address onto the port in use", () => {
      const { environment, realigned } = align({
        NODE_ENV: "development",
        PORT: "5620",
        BASE_HOST: "http://localhost:5560",
        NEXTAUTH_URL: "http://localhost:5560",
      });

      expect(environment.BASE_HOST).toBe("http://localhost:5620");
      expect(environment.NEXTAUTH_URL).toBe("http://localhost:5620");
      expect(realigned.map((entry) => entry.name)).toEqual(["BASE_HOST", "NEXTAUTH_URL"]);
    });

    it("reports what it changed so the launcher can say so", () => {
      const { realigned } = align({
        NODE_ENV: "development",
        PORT: "5620",
        NEXTAUTH_URL: "http://localhost:5560",
      });

      expect(realigned).toEqual([
        { name: "NEXTAUTH_URL", from: "http://localhost:5560", to: "http://localhost:5620" },
      ]);
    });

    it("never writes the environment it was handed", () => {
      const original = {
        NODE_ENV: "development",
        PORT: "5620",
        BASE_HOST: "http://localhost:5560",
      };

      align(original);

      expect(original.BASE_HOST).toBe("http://localhost:5560");
    });

    it("prefers the stack's app port over PORT", () => {
      const { environment } = align({
        NODE_ENV: "development",
        LANGWATCH_APP_PORT: "5700",
        PORT: "5620",
        BASE_HOST: "http://localhost:5560",
      });

      expect(environment.BASE_HOST).toBe("http://localhost:5700");
    });
  });

  describe("when the address the app hands out as itself names the committed default port", () => {
    /** @scenario "The address handed to the agent worker follows the port the app was started on" */
    it("realigns LANGWATCH_ENDPOINT onto the port in use", () => {
      const { environment, realigned } = align({
        NODE_ENV: "development",
        PORT: "5580",
        LANGWATCH_ENDPOINT: "http://localhost:5560",
      });

      expect(environment.LANGWATCH_ENDPOINT).toBe("http://localhost:5580");
      expect(realigned).toEqual([
        { name: "LANGWATCH_ENDPOINT", from: "http://localhost:5560", to: "http://localhost:5580" },
      ]);
    });

    it("leaves a deliberately configured endpoint alone", () => {
      const { environment, realigned } = align({
        NODE_ENV: "development",
        PORT: "5580",
        LANGWATCH_ENDPOINT: "https://app.langwatch.ai",
      });

      expect(realigned).toEqual([]);
      expect(environment.LANGWATCH_ENDPOINT).toBe("https://app.langwatch.ai");
    });
  });

  describe("when an address already names the port in use", () => {
    it("changes nothing", () => {
      const { environment, realigned } = align({
        NODE_ENV: "development",
        PORT: "5620",
        NEXTAUTH_URL: "http://localhost:5620",
      });

      expect(realigned).toEqual([]);
      expect(environment.NEXTAUTH_URL).toBe("http://localhost:5620");
    });
  });
});

describe("given an address that was set deliberately", () => {
  /** @scenario "A deliberately configured address is left alone" */
  it.each([
    ["a proxy in front of a preview environment", "https://preview.example.com"],
    ["a loopback IP", "http://127.0.0.1:5560"],
    ["a hostname-routed local stack", "https://app.mystack.langwatch.localhost"],
    ["a tunnel", "http://abc123.ngrok.io"],
    ["a value that is not a URL at all", "not-a-url"],
  ])("leaves %s untouched", (_label, address) => {
    const { environment, realigned } = align({
      NODE_ENV: "development",
      PORT: "5620",
      LANGWATCH_APP_PORT: "5620",
      BASE_HOST: address,
      NEXTAUTH_URL: address,
    });

    expect(realigned).toEqual([]);
    expect(environment.BASE_HOST).toBe(address);
    expect(environment.NEXTAUTH_URL).toBe(address);
  });
});

describe("given a deployed installation", () => {
  /** @scenario "A real deployment is never rewritten" */
  it("rewrites nothing whatever the port, even a plain localhost address", () => {
    const { environment, realigned } = align({
      NODE_ENV: "production",
      PORT: "5620",
      BASE_HOST: "https://app.langwatch.ai",
      NEXTAUTH_URL: "http://localhost:5560",
    });

    expect(realigned).toEqual([]);
    expect(environment.BASE_HOST).toBe("https://app.langwatch.ai");
    expect(environment.NEXTAUTH_URL).toBe("http://localhost:5560");
  });
});

describe("given no port to align to", () => {
  it("leaves the configured address as it is", () => {
    const { environment, realigned } = align({
      NODE_ENV: "development",
      NEXTAUTH_URL: "http://localhost:5560",
    });

    expect(realigned).toEqual([]);
    expect(environment.NEXTAUTH_URL).toBe("http://localhost:5560");
  });
});

describe("given addresses the launcher pinned for other services", () => {
  /** @scenario "Addresses deliberately pinned in the environment file still win" */
  it("touches only the app's own addresses", () => {
    const { environment } = align({
      NODE_ENV: "development",
      PORT: "5620",
      NEXTAUTH_URL: "http://localhost:5560",
      LW_GATEWAY_PUBLIC_URL: "http://host.minikube.internal:5563",
      LANGWATCH_NLP_SERVICE: "http://localhost:5561",
    });

    expect(environment.LW_GATEWAY_PUBLIC_URL).toBe("http://host.minikube.internal:5563");
    expect(environment.LANGWATCH_NLP_SERVICE).toBe("http://localhost:5561");
  });
});
