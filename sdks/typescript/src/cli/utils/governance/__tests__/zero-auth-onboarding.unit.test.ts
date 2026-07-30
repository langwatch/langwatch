import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appEnvValues, claudeProjectSettingsTarget } from "../app-settings";
import {
  conflictingExporter,
  installTelemetry,
  machineFingerprint,
  onboardingSummary,
  ProvisioningFailedError,
  type ProvisionResult,
  provisionEphemeralAccount,
} from "../zero-auth-onboarding";

const PROVISIONED: ProvisionResult = {
  account: {
    organizationId: "org_1",
    projectId: "proj_1",
    projectSlug: "claude-code-abc",
    projectName: "Claude Code",
  },
  ingestion: {
    apiKey: "ik-lw-secret-token",
    keyPrefix: "ik-lw-secre",
    endpoint: "https://app.langwatch.ai",
    otlpEndpoint: "https://app.langwatch.ai/api/otel",
  },
  claim: {
    token: "claim-token",
    url: "https://app.langwatch.ai/claim",
    claimableUntil: "2026-08-29T00:00:00.000Z",
  },
  lifecycle: {
    state: "active",
    provisionedAt: "2026-07-30T00:00:00.000Z",
    ingestionStopsAt: "2026-08-06T00:00:00.000Z",
    deleteAfter: "2026-08-29T00:00:00.000Z",
    daysRemainingInPhase: 7,
  },
  notice: {
    dataRetention: "Your traces are collected and viewable for 7 days.",
    claimWindow: "Claim this account within 30 days to keep everything, free.",
    afterExpiry: "Unclaimed accounts and their data are deleted after that.",
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lw-onboarding-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("provisioning a temporary account", () => {
  describe("given the server accepts", () => {
    /** @scenario "with no identity, the command provisions instead of refusing" */
    it("returns the provisioned account", async () => {
      const result = await provisionEphemeralAccount({
        endpoint: "https://app.langwatch.ai",
        tool: "claude",
        fetchImpl: async () => jsonResponse(PROVISIONED),
      });

      expect(result.ingestion.apiKey).toBe("ik-lw-secret-token");
    });

    it("asks for the agent slug the server knows, not the wrapper's name", async () => {
      let sentBody: unknown;
      await provisionEphemeralAccount({
        endpoint: "https://app.langwatch.ai",
        tool: "claude",
        fetchImpl: async (_url, init) => {
          sentBody = JSON.parse(init?.body as string);
          return jsonResponse(PROVISIONED);
        },
      });

      // The wrapper calls it "claude"; the server's enum says "claude_code".
      expect(sentBody).toEqual({ agent: "claude_code" });
    });

    it("sends a fingerprint that is not the raw machine identity", async () => {
      let sent: string | undefined;
      await provisionEphemeralAccount({
        endpoint: "https://app.langwatch.ai",
        tool: "claude",
        fetchImpl: async (_url, init) => {
          sent =
            new Headers(init?.headers).get("x-langwatch-fingerprint") ?? "";
          return jsonResponse(PROVISIONED);
        },
      });

      expect(sent).toBe(machineFingerprint());
      expect(sent).not.toContain(os.hostname());
      expect(sent).not.toContain(os.userInfo().username);
      expect(sent).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("given the server refuses", () => {
    it("surfaces the server's own copy rather than inventing its own", async () => {
      // Rate limits and disabled instances carry copy written for this exact
      // moment; a generic "HTTP 429" would throw that away.
      const error = await provisionEphemeralAccount({
        endpoint: "https://app.langwatch.ai",
        tool: "claude",
        fetchImpl: async () =>
          jsonResponse(
            {
              code: "rate_limited",
              message: "Too many requests. Try again shortly.",
            },
            429,
          ),
      }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ProvisioningFailedError);
      expect((error as Error).message).toContain("Too many requests");
      expect((error as ProvisioningFailedError).status).toBe(429);
    });

    it("includes the remediation tips when the error carries them", async () => {
      const error = await provisionEphemeralAccount({
        endpoint: "https://app.langwatch.ai",
        tool: "claude",
        fetchImpl: async () =>
          jsonResponse(
            {
              code: "ephemeral_account_expired",
              message: "This temporary account has been deleted.",
              tips: ["Run `npx langwatch claude` to start a new one."],
            },
            410,
          ),
      }).catch((e: unknown) => e);

      expect((error as Error).message).toContain("start a new one");
    });

    it("falls back to a status message when the body is not a handled error", async () => {
      const error = await provisionEphemeralAccount({
        endpoint: "https://app.langwatch.ai",
        tool: "claude",
        fetchImpl: async () =>
          new Response("<html>502</html>", { status: 502 }),
      }).catch((e: unknown) => e);

      expect((error as Error).message).toContain("502");
    });
  });

  describe("given the endpoint is unreachable", () => {
    it("names the endpoint it could not reach", async () => {
      const error = await provisionEphemeralAccount({
        endpoint: "https://app.langwatch.ai",
        tool: "claude",
        fetchImpl: async () => {
          throw new Error("ECONNREFUSED");
        },
      }).catch((e: unknown) => e);

      expect((error as Error).message).toContain("app.langwatch.ai");
    });
  });

  describe("given a tool with no onboarding defined", () => {
    it("refuses rather than guessing a slug", async () => {
      await expect(
        provisionEphemeralAccount({
          endpoint: "https://app.langwatch.ai",
          tool: "nonesuch",
          fetchImpl: async () => jsonResponse(PROVISIONED),
        }),
      ).rejects.toBeInstanceOf(ProvisioningFailedError);
    });
  });
});

describe("wiring the telemetry into the project", () => {
  describe("given a fresh directory", () => {
    /** @scenario "telemetry is written to the git-ignored settings file" */
    it("writes the exporter into the git-ignored local settings", () => {
      const target = installTelemetry({
        tool: "claude",
        cwd: tmp,
        provisioned: PROVISIONED,
      });

      expect(target.displayPath).toBe(".claude/settings.local.json");
      const env = appEnvValues(target);
      expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
        "https://app.langwatch.ai/api/otel",
      );
      expect(env.OTEL_EXPORTER_OTLP_HEADERS).toContain("ik-lw-secret-token");
    });
  });

  describe("when it runs again in the same directory", () => {
    /** @scenario "re-running updates in place rather than stacking a second block" */
    it("updates in place rather than stacking a second block", () => {
      installTelemetry({ tool: "claude", cwd: tmp, provisioned: PROVISIONED });
      installTelemetry({ tool: "claude", cwd: tmp, provisioned: PROVISIONED });

      const raw = fs.readFileSync(
        claudeProjectSettingsTarget(tmp).path,
        "utf8",
      );
      const parsed = JSON.parse(raw) as { env: Record<string, string> };
      expect(
        Object.keys(parsed.env).filter(
          (k) => k === "OTEL_EXPORTER_OTLP_ENDPOINT",
        ),
      ).toHaveLength(1);
    });

    it("preserves settings the developer wrote themselves", () => {
      const target = claudeProjectSettingsTarget(tmp);
      fs.mkdirSync(path.dirname(target.path), { recursive: true });
      fs.writeFileSync(
        target.path,
        JSON.stringify({ permissions: { allow: ["Bash"] } }),
      );

      installTelemetry({ tool: "claude", cwd: tmp, provisioned: PROVISIONED });

      const parsed = JSON.parse(fs.readFileSync(target.path, "utf8")) as {
        permissions?: unknown;
      };
      expect(parsed.permissions).toEqual({ allow: ["Bash"] });
    });
  });
});

describe("detecting somebody else's exporter", () => {
  describe("given settings already exporting elsewhere", () => {
    /** @scenario "an existing exporter pointing somewhere else is not silently taken over" */
    it("reports the conflict so the caller can ask first", () => {
      const target = claudeProjectSettingsTarget(tmp);
      installTelemetry({ tool: "claude", cwd: tmp, provisioned: PROVISIONED });
      fs.writeFileSync(
        target.path,
        JSON.stringify({
          env: { OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.acme.internal" },
        }),
      );

      expect(
        conflictingExporter({
          target,
          otlpEndpoint: PROVISIONED.ingestion.otlpEndpoint,
        }),
      ).toBe("https://otel.acme.internal");
    });
  });

  describe("given settings already pointing at us", () => {
    it("reports no conflict — that is a re-run, not a takeover", () => {
      const target = claudeProjectSettingsTarget(tmp);
      installTelemetry({ tool: "claude", cwd: tmp, provisioned: PROVISIONED });

      expect(
        conflictingExporter({
          target,
          otlpEndpoint: PROVISIONED.ingestion.otlpEndpoint,
        }),
      ).toBeNull();
    });
  });

  describe("given a directory with no settings at all", () => {
    it("reports no conflict", () => {
      expect(
        conflictingExporter({
          target: claudeProjectSettingsTarget(tmp),
          otlpEndpoint: PROVISIONED.ingestion.otlpEndpoint,
        }),
      ).toBeNull();
    });
  });
});

describe("what the developer is told", () => {
  describe("given the server's notice", () => {
    /** @scenario "the deadlines come from the server, not from the CLI" */
    it("prints the server's copy, not numbers the CLI made up", () => {
      // A self-hosted install can run different windows; a hardcoded "7 days"
      // would confidently contradict its own server.
      const lines = onboardingSummary({
        provisioned: {
          ...PROVISIONED,
          notice: {
            dataRetention: "Your traces are viewable for 3 days.",
            claimWindow: "Claim within 14 days.",
            afterExpiry: "Then it goes.",
          },
        },
        settingsPath: ".claude/settings.local.json",
      });

      const text = lines.join("\n");
      expect(text).toContain("3 days");
      expect(text).toContain("14 days");
      expect(text).not.toContain("7 days");
    });

    it("never prints the ingestion key", () => {
      const text = onboardingSummary({
        provisioned: PROVISIONED,
        settingsPath: ".claude/settings.local.json",
      }).join("\n");

      expect(text).not.toContain("ik-lw-secret-token");
      expect(text).not.toContain("claim-token");
    });
  });
});
