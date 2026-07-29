/**
 * @vitest-environment node
 *
 * The rule that decides which app addresses get realigned onto the port the
 * process is actually serving. Covers specs/auth/dev-port-origin-alignment.feature.
 */
import { describe, expect, it } from "vitest";

import { alignDevAuthUrlsToPort } from "../env-create.mjs";

const align = alignDevAuthUrlsToPort as (
  env: Record<string, string | undefined>,
) => { name: string; from: string; to: string }[];

describe("alignDevAuthUrlsToPort", () => {
  describe("given a development process on a non-default port", () => {
    describe("when the configured address names the committed default port", () => {
      /** @scenario The address the app checks against follows the port it was started on */
      it("realigns both addresses onto the port in use", () => {
        const env = {
          NODE_ENV: "development",
          PORT: "5620",
          BASE_HOST: "http://localhost:5560",
          NEXTAUTH_URL: "http://localhost:5560",
        };

        const realigned = align(env);

        expect(env.BASE_HOST).toBe("http://localhost:5620");
        expect(env.NEXTAUTH_URL).toBe("http://localhost:5620");
        expect(realigned.map((entry) => entry.name)).toEqual([
          "BASE_HOST",
          "NEXTAUTH_URL",
        ]);
      });

      it("reports what it changed so the launcher can say so", () => {
        const env = {
          NODE_ENV: "development",
          PORT: "5620",
          NEXTAUTH_URL: "http://localhost:5560",
        };

        expect(align(env)).toEqual([
          {
            name: "NEXTAUTH_URL",
            from: "http://localhost:5560",
            to: "http://localhost:5620",
          },
        ]);
      });
    });

    describe("when the address already names the port in use", () => {
      it("changes nothing", () => {
        const env = {
          NODE_ENV: "development",
          PORT: "5620",
          NEXTAUTH_URL: "http://localhost:5620",
        };

        expect(align(env)).toEqual([]);
        expect(env.NEXTAUTH_URL).toBe("http://localhost:5620");
      });
    });

    describe("when the port comes from a hostname-routed stack", () => {
      /** @scenario A deliberately configured address is left alone */
      it("leaves the stack's own hostname alone", () => {
        const env = {
          NODE_ENV: "development",
          LANGWATCH_APP_PORT: "5620",
          BASE_HOST: "https://app.mystack.langwatch.localhost",
          NEXTAUTH_URL: "https://app.mystack.langwatch.localhost",
        };

        expect(align(env)).toEqual([]);
        expect(env.NEXTAUTH_URL).toBe(
          "https://app.mystack.langwatch.localhost",
        );
      });
    });
  });

  describe("given an address that was set deliberately", () => {
    /** @scenario A deliberately configured address is left alone */
    it.each([
      [
        "a proxy in front of a preview environment",
        "https://preview.example.com",
      ],
      [
        "a loopback IP, the shell helper's escape hatch",
        "http://127.0.0.1:5560",
      ],
      ["a tunnel", "http://abc123.ngrok.io"],
      ["a value that is not a URL at all", "not-a-url"],
    ])("leaves %s untouched", (_label, address) => {
      const env = {
        NODE_ENV: "development",
        PORT: "5620",
        NEXTAUTH_URL: address,
      };

      expect(align(env)).toEqual([]);
      expect(env.NEXTAUTH_URL).toBe(address);
    });
  });

  describe("given a deployed installation", () => {
    /** @scenario A real deployment is never rewritten */
    it("never rewrites anything, whatever the port", () => {
      const env = {
        NODE_ENV: "production",
        PORT: "5620",
        BASE_HOST: "http://localhost:5560",
        NEXTAUTH_URL: "http://localhost:5560",
      };

      expect(align(env)).toEqual([]);
      expect(env.NEXTAUTH_URL).toBe("http://localhost:5560");
    });
  });

  describe("given no port to align to", () => {
    it("leaves the configured address as it is", () => {
      const env = {
        NODE_ENV: "development",
        NEXTAUTH_URL: "http://localhost:5560",
      };

      expect(align(env)).toEqual([]);
      expect(env.NEXTAUTH_URL).toBe("http://localhost:5560");
    });
  });

  describe("given addresses the launcher pinned for other services", () => {
    /** @scenario Addresses deliberately pinned in the environment file still win */
    it("touches only the app's own address", () => {
      const env = {
        NODE_ENV: "development",
        PORT: "5620",
        NEXTAUTH_URL: "http://localhost:5560",
        LW_GATEWAY_PUBLIC_URL: "http://host.minikube.internal:5563",
        LANGWATCH_NLP_SERVICE: "http://localhost:5561",
      };

      align(env);

      expect(env.LW_GATEWAY_PUBLIC_URL).toBe(
        "http://host.minikube.internal:5563",
      );
      expect(env.LANGWATCH_NLP_SERVICE).toBe("http://localhost:5561");
    });
  });
});
