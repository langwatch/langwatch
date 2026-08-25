import { describe, expect, it } from "vitest";
import {
  collectSensitiveEnvValues,
  redactReportText,
  redactSessionJsonl,
  truncateJsonlToByteBudget,
} from "../sessionReport.js";

describe("collectSensitiveEnvValues", () => {
  describe("given an environment with secret-named and ordinary variables", () => {
    const env = {
      OPENAI_API_KEY: "sk-proj-abcdef1234567890abcdef",
      GITHUB_TOKEN: "ghp_0123456789012345678901234567890123456789",
      AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      DB_PASSWORD: "hunter2hunter2",
      PORT: "5560",
      NODE_ENV: "production",
      SHORT_KEY: "abc",
      EMPTY_TOKEN: "",
    };

    it("collects only the secret-named values", () => {
      const values = collectSensitiveEnvValues(env);
      expect(values).toContain("sk-proj-abcdef1234567890abcdef");
      expect(values).toContain("ghp_0123456789012345678901234567890123456789");
      expect(values).toContain("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
      expect(values).toContain("hunter2hunter2");
      expect(values).not.toContain("5560");
      expect(values).not.toContain("production");
    });

    it("skips values too short to be secrets", () => {
      expect(collectSensitiveEnvValues(env)).not.toContain("abc");
    });

    it("orders longest first so overlapping values scrub fully", () => {
      const values = collectSensitiveEnvValues(env);
      const lengths = values.map((v) => v.length);
      expect(lengths).toEqual([...lengths].sort((a, b) => b - a));
    });
  });
});

describe("redactReportText", () => {
  describe("when the text contains environment secret values", () => {
    it("removes every literal occurrence, in any context", () => {
      const envValues = collectSensitiveEnvValues({
        LANGWATCH_API_KEY: "sq-lw-notpatternshaped12345",
      });
      const result = redactReportText({
        text: "curl -H 'X-Auth: sq-lw-notpatternshaped12345' # retry sq-lw-notpatternshaped12345",
        envValues,
      });
      expect(result.text).not.toContain("sq-lw-notpatternshaped12345");
      expect(result.text).toContain("[SECRET]");
      expect(result.redactedCount).toBe(2);
    });
  });

  describe("when the text contains credential patterns", () => {
    it("redacts provider API keys", () => {
      const result = redactReportText({
        text: "using sk-proj-abcdefghijklmnopqrstuvwxyz123456 for the call",
      });
      expect(result.text).toBe("using [SECRET] for the call");
    });

    it("redacts bearer tokens keeping the Bearer prefix", () => {
      const result = redactReportText({
        text: "Authorization: Bearer abc123def456ghi789",
      });
      expect(result.text).toBe("Authorization: Bearer [SECRET]");
    });

    it("redacts only the password inside connection URLs", () => {
      const result = redactReportText({
        text: "postgres://app:supersecretpw@db.internal:5432/app",
      });
      expect(result.text).toBe("postgres://app:[SECRET]@db.internal:5432/app");
    });
  });

  describe("when the text contains personal data", () => {
    /** @scenario "Session redaction covers secrets, emails, phone numbers, and cards" */
    it("redacts email addresses", () => {
      const result = redactReportText({
        text: "contact me at jane.doe@acme.com please",
      });
      expect(result.text).toBe("contact me at [EMAIL_ADDRESS] please");
    });

    it("redacts international phone numbers", () => {
      const result = redactReportText({ text: "call +31 6 12345678 tomorrow" });
      expect(result.text).toBe("call [PHONE_NUMBER] tomorrow");
    });

    it("redacts punctuated national phone numbers", () => {
      expect(redactReportText({ text: "tel (415) 555-2671." }).text).toBe(
        "tel [PHONE_NUMBER].",
      );
      expect(redactReportText({ text: "tel 415-555-2671." }).text).toBe(
        "tel [PHONE_NUMBER].",
      );
    });

    it("redacts Luhn-valid card numbers, formatted or bare", () => {
      expect(redactReportText({ text: "card 4111 1111 1111 1111 on file" }).text).toBe(
        "card [CREDIT_CARD] on file",
      );
      expect(redactReportText({ text: "card 4111111111111111 ok" }).text).toBe(
        "card [CREDIT_CARD] ok",
      );
    });

    it("redacts public IP addresses", () => {
      const result = redactReportText({ text: "resolved to 8.8.8.8 upstream" });
      expect(result.text).toBe("resolved to [IP_ADDRESS] upstream");
    });
  });

  describe("when the text contains debugging data that only looks sensitive", () => {
    /** @scenario "Loopback and private network addresses stay readable" */
    it("keeps loopback and private addresses", () => {
      const text =
        "listening on 127.0.0.1:5560, lan 192.168.1.5, vpc 10.0.0.3, docker 172.17.0.2";
      expect(redactReportText({ text }).text).toBe(text);
    });

    it("keeps millisecond timestamps (13 bare digits are not a card)", () => {
      const text = "startedAt 1753371234567 finished";
      expect(redactReportText({ text }).text).toBe(text);
    });

    it("keeps Luhn-invalid digit runs", () => {
      const text = "trace id 4111111111111112 continues";
      expect(redactReportText({ text }).text).toBe(text);
    });

    it("keeps versions, dates, and diff hunk headers", () => {
      const text = "v1.2.3 released 2026-07-24, hunk @@ -1,3 +1,4 @@ applied";
      expect(redactReportText({ text }).text).toBe(text);
    });
  });

  describe("when a single string is longer than the secret-scan budget", () => {
    it("still redacts secrets deep inside it", () => {
      const filler = "x".repeat(300_000);
      const text = `${filler}\nkey sk-proj-abcdefghijklmnopqrstuvwxyz123456 end`;
      const result = redactReportText({ text });
      expect(result.text).not.toContain("sk-proj-abcdefghijklmnopqrstuvwxyz123456");
      expect(result.text).toContain("[SECRET]");
    });
  });
});

describe("redactSessionJsonl", () => {
  describe("given a transcript with JSON lines", () => {
    it("scrubs whole values under sensitive keys", () => {
      const jsonl = JSON.stringify({
        request: {
          headers: { authorization: "Basic dXNlcjpwYXNz", accept: "*/*" },
        },
      });
      const result = redactSessionJsonl({ jsonl });
      const parsed = JSON.parse(result.text) as {
        request: { headers: { authorization: string; accept: string } };
      };
      expect(parsed.request.headers.authorization).toBe("[SECRET]");
      expect(parsed.request.headers.accept).toBe("*/*");
    });

    it("pattern-redacts strings while preserving the structure", () => {
      const jsonl = [
        JSON.stringify({
          role: "user",
          content: "my key is sk-proj-abcdefghijklmnopqrstuvwxyz123456",
        }),
        JSON.stringify({
          role: "assistant",
          content: "ok, email jane@acme.com",
        }),
      ].join("\n");
      const result = redactSessionJsonl({ jsonl });
      const lines = result.text
        .split("\n")
        .map((l) => JSON.parse(l) as { content: string });
      expect(lines[0]?.content).toBe("my key is [SECRET]");
      expect(lines[1]?.content).toBe("ok, email [EMAIL_ADDRESS]");
      expect(result.redactedCount).toBe(2);
    });

    it("redacts lines that fail to parse as plain text", () => {
      const jsonl = "not json but has sk-proj-abcdefghijklmnopqrstuvwxyz123456 inside";
      const result = redactSessionJsonl({ jsonl });
      expect(result.text).toBe("not json but has [SECRET] inside");
    });

    it("preserves blank lines", () => {
      const jsonl = '{"a":1}\n\n{"b":2}';
      const result = redactSessionJsonl({ jsonl });
      expect(result.text.split("\n")).toHaveLength(3);
    });
  });
});

describe("truncateJsonlToByteBudget", () => {
  describe("given a transcript under the budget", () => {
    it("returns it untouched", () => {
      const result = truncateJsonlToByteBudget({
        jsonl: "a\nb\nc",
        maxBytes: 100,
      });
      expect(result).toEqual({ text: "a\nb\nc", truncated: false });
    });
  });

  describe("given a transcript over the budget", () => {
    /** @scenario "Oversized sessions are truncated from the start, keeping the most recent activity" */
    it("keeps only the most recent whole lines and flags truncation", () => {
      const lines = Array.from({ length: 100 }, (_, i) => `line-${i}-${"y".repeat(50)}`);
      const result = truncateJsonlToByteBudget({
        jsonl: lines.join("\n"),
        maxBytes: 300,
      });
      expect(result.truncated).toBe(true);
      const kept = result.text.split("\n");
      expect(kept.length).toBeGreaterThan(0);
      expect(kept.length).toBeLessThan(10);
      expect(kept.at(-1)).toBe(lines.at(-1));
      for (const line of kept) expect(lines).toContain(line);
    });
  });
});
