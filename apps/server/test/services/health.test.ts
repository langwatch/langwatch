import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { execCheck, httpGetCheck, pollUntilHealthy } from "../../src/services/health.ts";

describe("httpGetCheck", () => {
  describe("when the URL returns 200", () => {
    it("reports ok with positive durationMs", async () => {
      const server = createServer((_, res) => {
        res.writeHead(200);
        res.end("Ok.");
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const port = (server.address() as { port: number }).port;
      try {
        const result = await httpGetCheck(`http://127.0.0.1:${port}/`)();
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.durationMs).toBeGreaterThanOrEqual(0);
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    });
  });

  describe("when expectStatus is set and the URL returns a different status", () => {
    it("reports a clear reason", async () => {
      const server = createServer((_, res) => {
        res.writeHead(503);
        res.end("nope");
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const port = (server.address() as { port: number }).port;
      try {
        const result = await httpGetCheck(`http://127.0.0.1:${port}/`, { expectStatus: 200 })();
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toContain("503");
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    });
  });

  describe("when expectBodyContains is set and the body matches", () => {
    it("reports ok", async () => {
      const server = createServer((_, res) => {
        res.writeHead(200);
        res.end("Ok.");
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const port = (server.address() as { port: number }).port;
      try {
        const result = await httpGetCheck(`http://127.0.0.1:${port}/`, {
          expectBodyContains: "Ok.",
        })();
        expect(result.ok).toBe(true);
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    });
  });

  describe("when the URL is unreachable", () => {
    it("reports the connect error in the reason", async () => {
      const result = await httpGetCheck("http://127.0.0.1:1/")();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
    });
  });
});

describe("execCheck", () => {
  describe("when the command exits 0 with expected stdout", () => {
    it("reports ok", async () => {
      const result = await execCheck("node", ["-e", "process.stdout.write('PONG')"], {
        expectStdoutContains: "PONG",
      })();
      expect(result.ok).toBe(true);
    });
  });

  describe("when the command exits non-zero", () => {
    it("reports the exit code in the reason", async () => {
      const result = await execCheck("node", ["-e", "process.exit(7)"])();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("exit 7");
    });
  });

  describe("when the command exits 0 but stdout doesn't match", () => {
    it("reports the missing-substring reason", async () => {
      const result = await execCheck("node", ["-e", "process.stdout.write('hello')"], {
        expectStdoutContains: "PONG",
      })();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("PONG");
    });
  });
});

describe("pollUntilHealthy", () => {
  describe("when the check succeeds on the first attempt", () => {
    it("returns ok with very low durationMs", async () => {
      const result = await pollUntilHealthy({
        check: async () => ({ ok: true, durationMs: 0 }),
        timeoutMs: 5000,
        intervalMs: 50,
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.durationMs).toBeLessThan(100);
    });
  });

  describe("when the check eventually succeeds", () => {
    it("polls until ok and reports total time", async () => {
      let attempts = 0;
      const result = await pollUntilHealthy({
        check: async () => {
          attempts += 1;
          if (attempts < 3) return { ok: false, durationMs: 0, reason: `attempt ${attempts}` };
          return { ok: true, durationMs: 0 };
        },
        timeoutMs: 5000,
        intervalMs: 20,
      });
      expect(result.ok).toBe(true);
      expect(attempts).toBe(3);
    });
  });

  describe("when the check never succeeds within the timeout", () => {
    it("returns the last failure reason", async () => {
      const result = await pollUntilHealthy({
        check: async () => ({ ok: false, durationMs: 0, reason: "still down" }),
        timeoutMs: 200,
        intervalMs: 50,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("timed out");
        expect(result.reason).toContain("still down");
      }
    });
  });
});
