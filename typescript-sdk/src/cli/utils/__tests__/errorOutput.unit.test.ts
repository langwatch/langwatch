/**
 * How a failure is rendered, in each of the two shapes a caller can ask for.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readCliErrorDocument } from "@langwatch/cli-cards/domain-error";

import { LangWatchDomainError } from "@/internal/api/errors";
import {
  commandValidationError,
  readCommandError,
  reportCommandError,
  renderErrorAsJson,
  renderErrorForHumans,
  resolveOutputFormat,
  setOutputFormat,
} from "../errorOutput";

const domainError = ({
  kind = "dataset_not_found",
  message = "Dataset not found: sales-q3",
  httpStatus = 404,
  meta = { id: "sales-q3" } as Record<string, unknown>,
  traceId = "4bf92f3577b34da6a3ce929d0e0e4736" as string | undefined,
  reasons = undefined as { kind: string }[] | undefined,
} = {}) =>
  new LangWatchDomainError({
    domain: { kind, message, httpStatus, meta, isDomain: true, traceId, reasons },
    body: { error: kind, message, ...meta },
    operation: "GET /api/dataset/sales-q3",
    message,
  });

describe("given a failure the platform named", () => {
  describe("when rendering it for a person", () => {
    it("leads with the platform's sentence", () => {
      const rendered = renderErrorForHumans(readCommandError(domainError()));

      expect(rendered.split("\n")[0]).toBe("Dataset not found: sales-q3");
    });

    it("prints the kind, the status and the trace id under it", () => {
      const rendered = renderErrorForHumans(readCommandError(domainError()));

      expect(rendered).toContain("dataset_not_found");
      expect(rendered).toContain("404");
      expect(rendered).toContain("4bf92f3577b34da6a3ce929d0e0e4736");
    });

    it("prints the meta the platform attached", () => {
      const rendered = renderErrorForHumans(readCommandError(domainError()));

      expect(rendered).toContain("sales-q3");
    });

    it("names the chain when the failure had a cause", () => {
      const rendered = renderErrorForHumans(
        readCommandError(
          domainError({ reasons: [{ kind: "gateway_timeout" }, { kind: "unknown" }] }),
        ),
      );

      expect(rendered).toContain("gateway_timeout → unknown");
    });
  });

  describe("when rendering it for a machine", () => {
    it("emits a document a parser can read the kind, meta and trace id out of", () => {
      const json = renderErrorAsJson(readCommandError(domainError()));
      const parsed = readCliErrorDocument(json);

      expect(parsed).toMatchObject({
        kind: "dataset_not_found",
        httpStatus: 404,
        meta: { id: "sales-q3" },
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        isDomain: true,
      });
    });

    it("marks the document as a failure so it cannot be mistaken for a result", () => {
      const parsed: unknown = JSON.parse(
        renderErrorAsJson(readCommandError(domainError())),
      );

      expect(parsed).toMatchObject({ ok: false });
    });
  });
});

describe("given an infrastructure failure the platform did NOT name", () => {
  describe("when rendering it for a person", () => {
    it("prints the sentence alone, inventing no kind the platform never gave", () => {
      const rendered = renderErrorForHumans(
        readCommandError(new Error("fetch failed")),
      );

      expect(rendered).toBe("fetch failed");
      expect(rendered).not.toContain("kind");
    });
  });

  describe("when rendering it for a machine", () => {
    it("says plainly that this was not the caller's fault", () => {
      const parsed = readCliErrorDocument(
        renderErrorAsJson(readCommandError(new Error("fetch failed"))),
      );

      expect(parsed?.isDomain).toBe(false);
    });
  });
});

describe("given a server echoes a credential back in its message", () => {
  const API_KEY = "sk-live-abcdef0123456789";

  beforeEach(() => {
    process.env.LANGWATCH_API_KEY = API_KEY;
  });

  afterEach(() => {
    delete process.env.LANGWATCH_API_KEY;
  });

  const echoed = () =>
    domainError({
      kind: "project_not_found",
      message: `No project for key ${API_KEY}`,
      meta: { projectId: "project-1" },
    });

  describe("when rendering it for a person", () => {
    it("redacts the key from the message", () => {
      const rendered = renderErrorForHumans(readCommandError(echoed()));

      expect(rendered).not.toContain(API_KEY);
      expect(rendered).toContain("[redacted]");
    });
  });

  describe("when rendering it for a machine", () => {
    it("redacts the key from the document", () => {
      const json = renderErrorAsJson(readCommandError(echoed()));

      expect(json).not.toContain(API_KEY);
    });
  });
});

/**
 * The other half of the redaction contract, and the one it is easy to get wrong.
 *
 * `meta` is a payload the platform CURATES for a user to act on — it never holds
 * a secret by construction. Scrubbing it anyway would be worse than useless: the
 * credential patterns match legitimate identifiers, so an over-eager scrub turns
 * the id the user needed into `[redacted]` and hides the answer inside the error
 * that was supposed to give it.
 */
describe("given a domain error whose meta holds an actionable identifier", () => {
  const withKeyLikeIds = () =>
    domainError({
      kind: "virtual_key_not_found",
      message: "Virtual key not found",
      meta: { virtualKeyId: "vk-abc123def456", handle: "lw-team-handle" },
      traceId: undefined,
    });

  describe("when rendering it for a person", () => {
    it("prints the identifier intact rather than redacting it", () => {
      const rendered = renderErrorForHumans(readCommandError(withKeyLikeIds()));

      expect(rendered).toContain("vk-abc123def456");
      expect(rendered).not.toContain("[redacted]");
    });
  });

  describe("when rendering it for a machine", () => {
    it("hands the identifier through so the agent can act on it", () => {
      const parsed = readCliErrorDocument(
        renderErrorAsJson(readCommandError(withKeyLikeIds())),
      );

      expect(parsed?.meta).toEqual({
        virtualKeyId: "vk-abc123def456",
        handle: "lw-team-handle",
      });
    });
  });
});

describe("given the format the command was invoked with", () => {
  afterEach(() => setOutputFormat(undefined));

  describe("when the caller states one explicitly", () => {
    it("uses the stated format over the recorded one", () => {
      setOutputFormat("json");

      expect(resolveOutputFormat("text")).toBe("text");
    });
  });

  describe("when the caller states nothing", () => {
    it("falls back to the format the running command recorded", () => {
      setOutputFormat("json");

      expect(resolveOutputFormat(undefined)).toBe("json");
    });

    it("defaults to text once a command without --format has run", () => {
      setOutputFormat("json");
      setOutputFormat(undefined);

      expect(resolveOutputFormat(undefined)).toBe("text");
    });
  });
});

describe("given a failure on a command path that has no spinner", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    setOutputFormat(undefined);
    vi.restoreAllMocks();
  });

  describe("when reported under --format json", () => {
    it("puts the structured document on stdout and only prose on stderr", () => {
      reportCommandError({ error: domainError(), format: "json" });

      const stdout = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
      const parsed = readCliErrorDocument(stdout);

      expect(parsed?.kind).toBe("dataset_not_found");
      expect(errorSpy).toHaveBeenCalled();
      expect(() => JSON.parse(stdout)).not.toThrow();
    });
  });

  describe("when reported under the default text output", () => {
    it("writes the human block to stderr and nothing to stdout", () => {
      reportCommandError({ error: domainError() });

      expect(logSpy).not.toHaveBeenCalled();
      const stderr = errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
      expect(stderr).toContain("Dataset not found: sales-q3");
    });
  });

  describe("when the failure is a local argument problem", () => {
    it("reads as a validation_error, not a guessed network one", () => {
      reportCommandError({
        error: commandValidationError("At least one record ID is required."),
        format: "json",
      });

      const stdout = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
      const parsed = readCliErrorDocument(stdout);

      expect(parsed?.kind).toBe("validation_error");
      expect(parsed?.isDomain).toBe(true);
      expect(parsed?.message).toBe("At least one record ID is required.");
    });
  });
});
