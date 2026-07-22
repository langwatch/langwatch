/**
 * How a failure is rendered, in each of the two shapes a caller can ask for.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import chalk from "chalk";
import { readCliErrorDocument } from "@langwatch/cli-cards/handled-error";

import { LangWatchHandledError } from "@/internal/api/errors";
import {
  ExecutionContext,
  withExecutionContext,
} from "../../daemon/execution";
import {
  commandValidationError,
  currentOutputScope,
  disableOutputColor,
  getOutputFormat,
  readCommandError,
  reportCommandError,
  renderErrorAsJson,
  renderErrorForHumans,
  resolveOutputFormat,
  setOutputFormat,
} from "../errorOutput";

const handledError = ({
  code = "dataset_not_found",
  message = "Dataset not found: sales-q3",
  httpStatus = 404,
  meta = { id: "sales-q3" } as Record<string, unknown>,
  traceId = "4bf92f3577b34da6a3ce929d0e0e4736" as string | undefined,
  traceUrl = undefined as string | undefined,
  reasons = undefined as { kind: string }[] | undefined,
  suggestions = undefined as string[] | undefined,
  docUrl = undefined as string | undefined,
} = {}) =>
  new LangWatchHandledError({
    handled: {
      code,
      kind: code,
      message,
      httpStatus,
      meta,
      isHandled: true,
      traceId,
      traceUrl,
      reasons,
      suggestions,
      docUrl,
    },
    body: { error: code, message, ...meta },
    operation: "GET /api/dataset/sales-q3",
    message,
  });

describe("given a failure the platform named", () => {
  describe("when rendering it for a person", () => {
    it("leads with the platform's sentence", () => {
      const rendered = renderErrorForHumans(readCommandError(handledError()));

      expect(rendered.split("\n")[0]).toBe("Error: Dataset not found: sales-q3");
    });

    it("prints the code, the status and the trace id under Details", () => {
      const rendered = renderErrorForHumans(readCommandError(handledError()));

      expect(rendered).toContain("Details:");
      expect(rendered).toContain("dataset_not_found");
      expect(rendered).toContain("404");
      expect(rendered).toContain("4bf92f3577b34da6a3ce929d0e0e4736");
    });

    it("prints the meta the platform attached", () => {
      const rendered = renderErrorForHumans(readCommandError(handledError()));

      expect(rendered).toContain("sales-q3");
    });

    it("names the chain when the failure had a cause", () => {
      const rendered = renderErrorForHumans(
        readCommandError(
          handledError({ reasons: [{ kind: "gateway_timeout" }, { kind: "unknown" }] }),
        ),
      );

      expect(rendered).toContain("gateway_timeout → unknown");
    });

    it("prints the trace link when the route sent one", () => {
      const rendered = renderErrorForHumans(
        readCommandError(
          handledError({ traceUrl: "https://grafana.example.com/explore?traceId=4bf" }),
        ),
      );

      expect(rendered).toContain("https://grafana.example.com/explore?traceId=4bf");
    });
  });

  describe("when rendering it for a machine", () => {
    it("emits a document a parser can read the code, meta and trace id out of", () => {
      const json = renderErrorAsJson(readCommandError(handledError()));
      const parsed = readCliErrorDocument(json);

      expect(parsed).toMatchObject({
        code: "dataset_not_found",
        kind: "dataset_not_found",
        httpStatus: 404,
        meta: { id: "sales-q3" },
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        isHandled: true,
      });
    });

    it("marks the document as a failure so it cannot be mistaken for a result", () => {
      const parsed: unknown = JSON.parse(
        renderErrorAsJson(readCommandError(handledError())),
      );

      expect(parsed).toMatchObject({ ok: false });
    });

    it("stays a single compact line in agent mode, pretty with -o json", () => {
      try {
        setOutputFormat("agents");
        const compact = renderErrorAsJson(readCommandError(handledError()));
        expect(compact).not.toContain("\n");
        expect(JSON.parse(compact)).toMatchObject({ ok: false });

        setOutputFormat("json");
        const pretty = renderErrorAsJson(readCommandError(handledError()));
        expect(pretty).toContain("\n");
      } finally {
        setOutputFormat(undefined);
      }
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

      expect(parsed?.isHandled).toBe(false);
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
    handledError({
      code: "project_not_found",
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
    handledError({
      code: "virtual_key_not_found",
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
      reportCommandError({ error: handledError(), format: "json" });

      const stdout = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
      const parsed = readCliErrorDocument(stdout);

      expect(parsed?.kind).toBe("dataset_not_found");
      expect(errorSpy).toHaveBeenCalled();
      expect(() => JSON.parse(stdout)).not.toThrow();
    });
  });

  describe("when reported under the default text output", () => {
    it("writes the human block to stderr and nothing to stdout", () => {
      reportCommandError({ error: handledError() });

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
      expect(parsed?.isHandled).toBe(true);
      expect(parsed?.message).toBe("At least one record ID is required.");
    });
  });
});

describe("given a failure the platform sent advice with", () => {
  const advised = () =>
    handledError({
      code: "budget_exceeded",
      message: "Budget exceeded: monthly cap reached",
      httpStatus: 402,
      meta: { budgetId: "budget-1" },
      suggestions: ["Raise the budget in the gateway settings"],
      docUrl: "https://langwatch.ai/docs/ai-gateway/budgets",
    });

  describe("when rendering it for a person", () => {
    it("prints the suggestions as a bulleted list and the docs link", () => {
      const rendered = renderErrorForHumans(readCommandError(advised()));

      expect(rendered).toContain("Suggestions:");
      expect(rendered).toContain("  - Raise the budget in the gateway settings");
      expect(rendered).toContain(
        "Docs: https://langwatch.ai/docs/ai-gateway/budgets",
      );
    });
  });

  describe("when rendering it for a machine", () => {
    it("carries the advice in the document", () => {
      const parsed = readCliErrorDocument(
        renderErrorAsJson(readCommandError(advised())),
      );

      expect(parsed).toMatchObject({
        code: "budget_exceeded",
        suggestions: ["Raise the budget in the gateway settings"],
        docUrl: "https://langwatch.ai/docs/ai-gateway/budgets",
      });
    });
  });
});

describe("given a failure the platform sent NO advice with", () => {
  describe("when the code is one the fallback table knows", () => {
    it("fills the human block from the fallback table", () => {
      const rendered = renderErrorForHumans(
        readCommandError(handledError({ code: "missing_api_key" })),
      );

      expect(rendered).toContain("Suggestions:");
      expect(rendered).toContain("langwatch login");
      expect(rendered).toContain("Docs: https://langwatch.ai/docs/integration/cli");
    });

    it("fills the JSON document from the same table", () => {
      const parsed = readCliErrorDocument(
        renderErrorAsJson(readCommandError(handledError({ code: "missing_api_key" }))),
      );

      expect(parsed?.suggestions?.length).toBeGreaterThan(0);
      expect(parsed?.docUrl).toBe("https://langwatch.ai/docs/integration/cli");
    });

    it("never overrides advice the platform DID send", () => {
      const rendered = renderErrorForHumans(
        readCommandError(
          handledError({
            code: "missing_api_key",
            suggestions: ["Use the project-scoped key from settings"],
          }),
        ),
      );

      expect(rendered).toContain("Use the project-scoped key from settings");
      expect(rendered).not.toContain("Or set LANGWATCH_API_KEY");
    });
  });

  describe("when the code is one the table does NOT know", () => {
    it("prints no Suggestions or Docs section at all", () => {
      const rendered = renderErrorForHumans(
        readCommandError(handledError({ code: "some_unlisted_code" })),
      );

      expect(rendered).not.toContain("Suggestions:");
      expect(rendered).not.toContain("Docs:");
    });
  });
});

/**
 * The daemon runs requests that share an execution window CONCURRENTLY, and
 * they can disagree about `--format`/`--agent`. The output context is scoped
 * per request (AsyncLocalStorage, entered by withExecutionContext) precisely
 * so the second writer cannot clobber the first request's error rendering.
 */
describe("given two concurrent daemon requests in one window", () => {
  const contextFor = (id: string) =>
    new ExecutionContext(id, () => undefined);

  describe("when they were invoked with different formats", () => {
    it("renders each request's errors in its OWN format", async () => {
      const render = (
        id: string,
        format: string | undefined,
        delayMs: number,
      ): Promise<string> =>
        withExecutionContext(contextFor(id), async () => {
          setOutputFormat(format);
          // Interleave: yield so the other request records ITS format before
          // this one renders. With the old module-global format, the second
          // write would win and one caller would get the wrong shape.
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          return resolveOutputFormat(undefined);
        });

      const [json, text] = await Promise.all([
        render("wants-json", "json", 5),
        render("wants-text", undefined, 1),
      ]);

      expect(json).toBe("json");
      expect(text).toBe("text");
      // Scoped writes never touch the ambient (in-process) fallback.
      expect(getOutputFormat()).toBe("text");
    });
  });

  describe("when one of them turns colour off (agent mode)", () => {
    it("scopes the decision to that request — chalk.level is never mutated", async () => {
      const savedLevel = chalk.level;
      try {
        chalk.level = 1;

        const observed = await withExecutionContext(
          contextFor("agent"),
          async () => {
            disableOutputColor();
            await new Promise((resolve) => setTimeout(resolve, 1));
            return {
              scopeColor: currentOutputScope()?.hasColor,
              level: chalk.level,
            };
          },
        );

        expect(observed.scopeColor).toBe(false);
        // The whole point: a concurrent request's colour is untouched, because
        // the process-global chalk.level was never touched.
        expect(observed.level).toBe(1);
        expect(chalk.level).toBe(1);
      } finally {
        chalk.level = savedLevel;
      }
    });

    it("still sets chalk.level outside a request scope (the in-process path)", () => {
      const savedLevel = chalk.level;
      try {
        chalk.level = 2;

        disableOutputColor();

        expect(chalk.level).toBe(0);
      } finally {
        chalk.level = savedLevel;
      }
    });
  });
});
