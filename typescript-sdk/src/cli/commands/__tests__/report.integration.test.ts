import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { reportCommand } from "../report";

/**
 * Integration tests for `langwatch report` against a REAL local HTTP server:
 * the command runs end-to-end (redaction included) and the assertions read
 * what actually arrived on the wire. Corresponds to
 * specs/typescript-sdk/cli-report.feature.
 */
describe("langwatch report", () => {
  let server: Server;
  let endpoint: string;
  let received: { path: string; headers: Record<string, unknown>; body: any }[];
  let respondWith: { status: number; body: string };
  let tempDir: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let data = "";
      req.on("data", (chunk: Buffer) => (data += chunk.toString()));
      req.on("end", () => {
        received.push({
          path: req.url ?? "",
          headers: { ...req.headers },
          body: data.length > 0 ? JSON.parse(data) : undefined,
        });
        res.writeHead(respondWith.status, { "content-type": "application/json" });
        res.end(respondWith.body);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    received = [];
    respondWith = { status: 201, body: JSON.stringify({ id: "report-123" }) };
    tempDir = mkdtempSync(join(tmpdir(), "lw-report-test-"));
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    delete process.env.LANGWATCH_API_KEY;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("given the user did not approve sending", () => {
    /** @scenario "Sending without user approval is rejected with instructions" */
    it("refuses with instructions to ask the user first", async () => {
      await expect(
        reportCommand({ summary: "docs pointed to a 404 endpoint" }),
      ).rejects.toThrow(/ask the user/i);
      expect(received).toHaveLength(0);
    });
  });

  describe("given nothing to report", () => {
    it("explains what a good report contains", async () => {
      await expect(reportCommand({ userApproved: true })).rejects.toThrow(
        /Nothing to report/,
      );
    });
  });

  describe("when sending a summary report", () => {
    /** @scenario "A summary report reaches the LangWatch backend" */
    /** @scenario "Reports work without an API key" */
    it("delivers title and summary and returns the report id", async () => {
      const result = await reportCommand({
        userApproved: true,
        endpoint,
        title: "scenario create 500",
        summary: "running scenario create returned HTTP 500 with no body",
      });

      expect(received).toHaveLength(1);
      expect(received[0]?.path).toBe("/api/bug-reports");
      expect(received[0]?.body.kind).toBe("summary");
      expect(received[0]?.body.title).toBe("scenario create 500");
      expect(received[0]?.body.summary).toContain("HTTP 500");
      expect(received[0]?.headers.authorization).toBeUndefined();
      expect((result as { data: { id: string } }).data.id).toBe("report-123");
    });

    /** @scenario "Secrets leaking into the title are redacted too" */
    it("redacts secrets that leak into the title", async () => {
      await reportCommand({
        userApproved: true,
        endpoint,
        title: "auth with sk-proj-abcdefghijklmnopqrstuvwxyz123456 failed",
        summary: "the key was rejected",
      });
      expect(received[0]?.body.title).toBe("auth with [SECRET] failed");
    });

    it("falls back to the summary's first line when the title is whitespace", async () => {
      await reportCommand({
        userApproved: true,
        endpoint,
        title: "   ",
        summary: "evaluator wizard hangs on step 2\nmore detail below",
      });
      expect(received[0]?.body.title).toBe("evaluator wizard hangs on step 2");
    });

    /** @scenario "Summary can be read from a file for long content" */
    it("reads the summary from a file", async () => {
      const notesPath = join(tempDir, "notes.md");
      writeFileSync(notesPath, "long write-up of the confusing evaluator setup");
      await reportCommand({
        userApproved: true,
        endpoint,
        title: "confusing evaluator setup",
        summaryFile: notesPath,
      });
      expect(received[0]?.body.summary).toBe(
        "long write-up of the confusing evaluator setup",
      );
    });

    /** @scenario "Reports are linked to the project when an API key is present" */
    it("attaches the API key when one is configured", async () => {
      process.env.LANGWATCH_API_KEY = "sk-lw-test-key-abcdef123456789012";
      await reportCommand({
        userApproved: true,
        endpoint,
        summary: "linked report",
      });
      expect(received[0]?.headers.authorization).toBe(
        "Bearer sk-lw-test-key-abcdef123456789012",
      );
    });
  });

  describe("when sending a full session report", () => {
    /** @scenario "A full session report attaches the redacted transcript" */
    it("redacts secrets and PII before anything leaves the machine", async () => {
      const sessionPath = join(tempDir, "session.jsonl");
      writeFileSync(
        sessionPath,
        [
          JSON.stringify({
            role: "user",
            content:
              "set OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456 and email jane@acme.com",
          }),
          JSON.stringify({
            role: "assistant",
            content: "done, server on 127.0.0.1:5560",
          }),
        ].join("\n"),
      );

      await reportCommand({
        userApproved: true,
        endpoint,
        title: "agent stuck",
        session: sessionPath,
      });

      const body = received[0]?.body;
      expect(body.kind).toBe("full_session");
      const wire = JSON.stringify(body);
      expect(wire).not.toContain("sk-proj-abcdefghijklmnopqrstuvwxyz123456");
      expect(wire).not.toContain("jane@acme.com");
      expect(body.sessionData).toContain("[SECRET]");
      expect(body.sessionData).toContain("[EMAIL_ADDRESS]");
      expect(body.sessionData).toContain("127.0.0.1:5560");
    });

    /** @scenario "Environment secrets are scrubbed even in unusual formats" */
    it("scrubs the literal values of sensitive environment variables", async () => {
      process.env.MY_SERVICE_TOKEN = "extremely-unique-token-value-98765";
      try {
        const sessionPath = join(tempDir, "session.jsonl");
        writeFileSync(
          sessionPath,
          JSON.stringify({
            role: "user",
            content: "auth failed for extremely-unique-token-value-98765 twice",
          }),
        );
        await reportCommand({ userApproved: true, endpoint, session: sessionPath });
        expect(JSON.stringify(received[0]?.body)).not.toContain(
          "extremely-unique-token-value-98765",
        );
      } finally {
        delete process.env.MY_SERVICE_TOKEN;
      }
    });

    /** @scenario "A missing session file fails with a helpful error" */
    it("reports a missing session file helpfully", async () => {
      await expect(
        reportCommand({
          userApproved: true,
          endpoint,
          session: join(tempDir, "nope.jsonl"),
        }),
      ).rejects.toThrow(/Session file not found/);
    });
  });

  describe("when using --dry-run", () => {
    /** @scenario "Dry run needs no user approval, because nothing is sent" */
    it("needs no user approval, because nothing is sent", async () => {
      const result = (await reportCommand({
        endpoint,
        summary: "previewing before asking the user",
        dryRun: true,
      })) as { data: { dryRun: boolean } };
      expect(received).toHaveLength(0);
      expect(result.data.dryRun).toBe(true);
    });

    /** @scenario "Dry run shows exactly what would be sent without sending it" */
    it("returns the redacted payload without sending anything", async () => {
      const result = (await reportCommand({
        userApproved: true,
        endpoint,
        summary: "key sk-proj-abcdefghijklmnopqrstuvwxyz123456 leaked",
        dryRun: true,
      })) as { data: { dryRun: boolean; payload: { summary: string } } };

      expect(received).toHaveLength(0);
      expect(result.data.dryRun).toBe(true);
      expect(result.data.payload.summary).toContain("[SECRET]");
    });
  });

  describe("when the backend rejects or is unreachable", () => {
    it("surfaces the HTTP status and suggests support", async () => {
      respondWith = { status: 500, body: "{}" };
      await expect(
        reportCommand({ userApproved: true, endpoint, summary: "boom" }),
      ).rejects.toThrow(/HTTP 500[\s\S]*support@langwatch.ai/);
    });

    /** @scenario "Backend being unreachable fails politely without losing the summary" */
    it("fails politely when the endpoint cannot be reached", async () => {
      await expect(
        reportCommand({
          userApproved: true,
          endpoint: "http://127.0.0.1:1",
          summary: "unreachable",
        }),
      ).rejects.toThrow(/Could not reach[\s\S]*support@langwatch.ai/);
    });
  });
});
