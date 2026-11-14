/**
 * The copy a failed tool call turns into.
 * @see specs/langy/langy-cli-tool-envelope.feature
 *      "A failure keeps its structure all the way to the card"
 */
import { describe, expect, it } from "vitest";

import { presentLangyToolError } from "../langy-tool-failure.ts";

const failureDocument = (error: Record<string, unknown>) => JSON.stringify({ ok: false, error });

const present = (errorText: unknown, title = "Creating scenario") =>
  presentLangyToolError({ title, errorText });

describe("presentLangyToolError", () => {
  describe("given a failure the platform refused on access", () => {
    const denial = failureDocument({
      code: "api_key_permission_denied",
      message: "API Key does not grant required permission: scenarios:manage",
      httpStatus: 403,
      meta: { permission: "scenarios:manage" },
      isHandled: true,
      suggestions: ["Ask an admin to raise your role"],
      docUrl: "https://docs.langwatch.ai/api-reference/api-keys",
    });

    // "You can't X here", not "you don't have permission to X". A denial means
    // the key-and-user intersection was empty, which is usually the caller
    // lacking the permission — but is also what a key that omits a permission
    // the caller DOES hold looks like. The response cannot separate the two, so
    // the card states the consequence, which is true either way.
    /** @scenario "A failure card says what went wrong in the user's terms" */
    it("names what the reader cannot do, in plain words, in one sentence", () => {
      expect(present(denial).message).toBe("You can't manage scenarios in this project.");
    });

    /** @scenario "A failure card says what went wrong in the user's terms" */
    it("never headlines the internal permission name", () => {
      const presentation = present(denial);
      expect(presentation.message).not.toContain("scenarios:manage");
      expect(presentation.message).not.toContain("API Key");
    });

    it("does not say the same thing again at a second altitude", () => {
      expect(present(denial).detail).not.toContain("manage scenarios");
    });

    // They did not issue the key Langy acts through and cannot re-scope it —
    // the system mints it from their own permissions.
    /** @scenario "A failure card says what went wrong in the user's terms" */
    it("points at the one person who can change it, and offers no link", () => {
      const presentation = present(denial);
      expect(presentation.detail).toBe("Ask whoever manages access for your team if you need it.");
      expect(presentation.docsUrl).toBeUndefined();
    });

    // The remediation channel is written for an API consumer holding their own
    // key. Nobody chatting in the panel issued one — Langy mints its own.
    it("drops next steps that are addressed to somebody else", () => {
      expect(present(denial).tips).toBeUndefined();
    });

    it("keeps the whole failure available to copy", () => {
      expect(present(denial).raw).toContain("api-reference/api-keys");
    });

    it("names what failed in the title", () => {
      expect(present(denial).title).toBe("Creating scenario failed");
    });

    it("marks it terminal so nothing retries a refusal", () => {
      expect(present(denial).terminal).toBe(true);
    });
  });

  describe("given the server's own permission_denied code", () => {
    const denied = ({
      code = "permission_denied",
      denialReason,
      permission = "scenarios:manage",
      message = "Permission denied",
    }: {
      code?: string;
      denialReason?: string;
      permission?: string;
      message?: string;
    }) =>
      present(
        failureDocument({
          code,
          message,
          httpStatus: 403,
          meta: { permission, denialReason },
          isHandled: true,
        }),
      );

    /** @scenario "A failure card says what went wrong in the user's terms" */
    it.each(["permission_denied", "project_permission_denied"])(
      "names the missing access for %s",
      (code) => {
        expect(denied({ code, denialReason: "no-grant" }).message).toBe(
          "You can't manage scenarios in this project.",
        );
      },
    );

    /** @scenario "A reader who lost access is told so" */
    it.each(["no-membership", "membership-disabled"])(
      "says access was removed for %s",
      (denialReason) => {
        const presentation = denied({ denialReason });
        expect(presentation.message).toBe("You no longer have access to this project.");
        expect(presentation.detail).toBe(
          "Ask whoever manages access for your team if you need it back.",
        );
      },
    );

    /** @scenario "A reader who lost access is told so" */
    it("names the one permission lost when the owner's access was reduced", () => {
      expect(denied({ denialReason: "owner-ceiling" }).message).toBe(
        "You can no longer manage scenarios in this project.",
      );
    });

    /** @scenario "A reader who lost access is told so" */
    it("keeps a reduced access to one action when the action has no plain words", () => {
      expect(denied({ denialReason: "owner-ceiling", permission: "agents:deploy" }).message).toBe(
        "This action isn't available to you any more in this project.",
      );
    });

    /** @scenario "A seat limit keeps the platform's own sentence" */
    it.each([
      ["developer-restricted", "This is outside your Developer seat"],
      ["lite-member-restricted", "This feature is not available for your account"],
    ])("keeps the server's seat sentence for %s", (denialReason, sentence) => {
      const presentation = denied({ denialReason, message: sentence });
      expect(presentation.message).toBe(sentence);
      expect(presentation.detail).toBe("Ask whoever manages seats for your team if you need it.");
    });
  });

  describe("given a denial that named no permission", () => {
    /** @scenario "A refused permission reads as a permissions problem" */
    it("still says the access does not cover it, with no invented detail", () => {
      const presentation = present(
        failureDocument({
          code: "forbidden",
          message: "Forbidden",
          httpStatus: 403,
          meta: {},
          isHandled: true,
        }),
      );
      expect(presentation.message).toBe("This action isn't available to you in this project.");
      expect(presentation.message).not.toContain("API key");
    });
  });

  // A 401 is Langy's own short-lived key refused, not the reader's access.
  describe.each([
    {
      code: "unauthorized",
      message: "Unauthorized",
      httpStatus: 401,
      suggestions: [
        "Check that your API key is still valid — run `langwatch login` to re-authenticate",
      ],
    },
    {
      code: "missing_api_key",
      message: "Not logged in and LANGWATCH_API_KEY is not set. Sign in with `langwatch login`.",
      httpStatus: 0,
      suggestions: ["Run `langwatch login` to authenticate"],
    },
    {
      code: "not_authenticated",
      message: "Not logged in. Run `langwatch login --device` to sign in via your company SSO.",
      httpStatus: 0,
      suggestions: [],
    },
  ])("given Langy's own credential failed with $code", (error) => {
    const failure = failureDocument({
      ...error,
      meta: {},
      isHandled: true,
      docUrl: "https://docs.langwatch.ai/platform/api-keys",
    });

    /** @scenario "Langy's own refused credential reads as an internal error" */
    it("says Langy hit an internal error", () => {
      expect(present(failure).message).toBe(
        "Langy hit an internal error and couldn't complete this step.",
      );
    });

    /** @scenario "Langy's own refused credential reads as an internal error" */
    it("never says the reader lacks access or tells them to sign in", () => {
      const presentation = present(failure);
      const shown = [presentation.message, presentation.detail, ...(presentation.tips ?? [])].join(
        " ",
      );
      expect(shown).not.toMatch(/manages access|isn't available to you|log ?in|sign in|api key/i);
      expect(presentation.tips).toBeUndefined();
      expect(presentation.docsUrl).toBeUndefined();
    });
  });

  describe("given a missing key on the developer's own machine", () => {
    /** @scenario "A missing key on the developer's own machine keeps the CLI's own words" */
    it.each(["missing_api_key", "unauthorized", "not_authenticated"])(
      "keeps the CLI's sentence and next steps for a local tool (%s)",
      (code) => {
        const presentation = presentLangyToolError({
          title: "Running a command",
          toolName: "local_bash",
          errorText: failureDocument({
            code,
            message: "Not logged in and LANGWATCH_API_KEY is not set.",
            httpStatus: 0,
            meta: {},
            isHandled: true,
            suggestions: ["Run `langwatch login` to authenticate"],
          }),
        });

        expect(presentation.message).toBe("Not logged in and LANGWATCH_API_KEY is not set.");
        expect(presentation.tips).toEqual(["Run `langwatch login` to authenticate"]);
      },
    );
  });

  // The failure the user hit: a free-plan scenario limit, rendered as
  // "Your access in this project doesn't cover this action."
  describe("given a plan limit the platform refused on", () => {
    const limitFailure = (meta: Record<string, unknown>) =>
      failureDocument({
        code: "resource_limit_exceeded",
        kind: "resource_limit_exceeded",
        message:
          "Free plan limit of 3 scenarios reached. To increase your limits, upgrade your plan at https://app.langwatch.ai/settings/subscription",
        httpStatus: 403,
        meta,
        isHandled: true,
      });

    const atLimit = limitFailure({
      limitType: "scenarios",
      current: 3,
      max: 3,
    });

    it("says the plan ran out, not that the access did", () => {
      expect(present(atLimit).message).toBe(
        "Your plan includes 3 scenarios, and all 3 are in use.",
      );
    });

    it("never describes a plan limit as a permissions problem", () => {
      expect(present(atLimit).message).not.toContain("access");
    });

    /** @scenario "A plan limit says what the plan includes and what is in use" */
    it("reports what ran out in the customer's words, never limitType", () => {
      expect(present(atLimit).limit).toMatchObject({
        label: "scenarios",
        current: 3,
        max: 3,
      });
      expect(present(atLimit).message).not.toContain("limitType");
    });

    it("counts below the ceiling read as a count, not as exhausted", () => {
      const partial = limitFailure({
        limitType: "datasets",
        current: 1,
        max: 3,
      });
      expect(present(partial).message).toBe("You're using 1 of the 3 datasets your plan includes.");
    });

    it("names a limit type the label table has never heard of in plain words", () => {
      const customGraphs = failureDocument({
        code: "resource_limit_exceeded",
        message: "You have reached the maximum number of custom graphs",
        httpStatus: 403,
        meta: { limitType: "customGraphs", current: 2, max: 2 },
        isHandled: true,
      });
      expect(present(customGraphs).limit?.label).toBe("custom graphs");
    });

    it("marks it terminal — no argument change can make room", () => {
      expect(present(atLimit).terminal).toBe(true);
    });

    it("still shows the code so it can be quoted", () => {
      expect(present(atLimit).code).toBe("resource_limit_exceeded");
    });
  });

  describe("given a 403 that is neither a denial nor a limit", () => {
    /** @scenario "A refusal on the same status for a different reason keeps its own words" */
    it("keeps the platform's own sentence rather than blaming access", () => {
      const blocked = failureDocument({
        code: "policy_violation",
        message: "The request was blocked by a content policy.",
        httpStatus: 403,
        meta: {},
        isHandled: true,
      });
      expect(present(blocked).message).toBe("The request was blocked by a content policy.");
      expect(present(blocked).code).toBe("policy_violation");
    });
  });

  describe("given a failure the platform explained itself", () => {
    const notFound = failureDocument({
      code: "dataset_not_found",
      message: "Dataset support-questions does not exist",
      httpStatus: 404,
      meta: {},
      isHandled: true,
    });

    it("keeps the platform's own sentence", () => {
      expect(present(notFound, "Loading dataset").message).toBe(
        "Dataset support-questions does not exist",
      );
    });

    // Remediation for a domain failure IS for this reader — it is about the
    // data, not about whoever holds a key.
    it("keeps next steps that apply to whoever is reading", () => {
      const withTips = failureDocument({
        code: "trace_not_found",
        message: "That trace is no longer available",
        httpStatus: 404,
        meta: {},
        isHandled: true,
        suggestions: ["Traces are removed after the retention window"],
      });
      expect(present(withTips, "Loading trace").tips).toEqual([
        "Traces are removed after the retention window",
      ]);
    });

    it("shows the code alongside it", () => {
      expect(present(notFound, "Loading dataset").code).toBe("dataset_not_found");
    });
  });

  // A code with no copy in this module is the case that used to render as a
  // shrug. It must name itself: that string is the only handle support has.
  describe("given a code the panel has no copy for", () => {
    const unknown = failureDocument({
      code: "clickhouse_unavailable",
      message: "Analytics storage is temporarily unavailable.",
      httpStatus: 503,
      meta: {},
      isHandled: false,
    });

    it("shows the platform's sentence as the headline", () => {
      expect(present(unknown, "Counting traces").message).toBe(
        "Analytics storage is temporarily unavailable.",
      );
    });

    it("shows the code verbatim", () => {
      expect(present(unknown, "Counting traces").code).toBe("clickhouse_unavailable");
    });

    it("does not call an members failure terminal", () => {
      expect(present(unknown, "Counting traces").terminal).toBeUndefined();
    });
  });

  describe("given a Python traceback and no structured failure", () => {
    const traceback = [
      "Traceback (most recent call last):",
      '  File "/app/langwatch_nlp/count.py", line 42, in count_rows',
      "    payload = json.loads(response.text)",
      '  File "/usr/lib/python3.11/json/__init__.py", line 346, in loads',
      "    return _default_decoder.decode(s)",
      "json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)",
    ].join("\n");

    it("names what failed", () => {
      expect(present(traceback, "Counting traces").title).toBe("Counting traces failed");
    });

    /** @scenario "A traceback is kept out of the card body" */
    it("says the step couldn't be completed", () => {
      expect(present(traceback, "Counting traces").message).toBe(
        "This step couldn't be completed.",
      );
    });

    /** @scenario "A traceback is kept out of the card body" */
    it("adds no detail line taken from the traceback", () => {
      expect(present(traceback, "Counting traces").detail).toBeUndefined();
    });

    it("keeps the whole traceback for the disclosure", () => {
      expect(present(traceback, "Counting traces").raw).toContain("JSONDecodeError");
    });

    it("keeps an exception line out of the body even with no frames", () => {
      const bare = "json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)";
      expect(present(bare, "Counting traces").detail).toBeUndefined();
      expect(present(bare, "Counting traces").raw).toBe(bare);
    });

    it("keeps a JavaScript stack out of the body too", () => {
      const stack = [
        "TypeError: Cannot read properties of undefined (reading 'rows')",
        "    at countRows (/app/dist/count.js:12:31)",
        "    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)",
      ].join("\n");
      expect(present(stack, "Counting traces").detail).toBeUndefined();
    });
  });

  describe("given a failure with no structure at all", () => {
    const stderr = "✖ Failed to reach the API: socket hang up (ECONNRESET)";

    it("names what failed", () => {
      expect(present(stderr).title).toBe("Creating scenario failed");
    });

    /** @scenario "A one-line failure sentence is still shown as a detail" */
    it("shows the text it was given rather than swallowing it", () => {
      expect(present(stderr).detail).toBe("Failed to reach the API: socket hang up (ECONNRESET)");
    });

    it("claims no code it was never given", () => {
      expect(present(stderr).code).toBeUndefined();
    });

    it("keeps the whole text for copying", () => {
      expect(present(stderr).raw).toContain("ECONNRESET");
    });
  });

  describe("given a sentence printed after a Python warning", () => {
    const stderr = [
      "DeprecationWarning: datetime.datetime.utcnow() is deprecated",
      "✖ Failed to reach the API: socket hang up (ECONNRESET)",
    ].join("\n");

    /** @scenario "A failed command says its exit code and its last error line" */
    it("does not take the warning for a stack trace and keeps the sentence", () => {
      expect(present(stderr).detail).toBe("Failed to reach the API: socket hang up (ECONNRESET)");
    });
  });

  describe("given a command on the developer's machine that failed", () => {
    const ESC = "\u001b";
    /** How the worker renders a shell result: the exit code, then stdout and stderr. */
    const shellResult = ({
      exitCode,
      stdout,
      stderr,
    }: {
      exitCode: string;
      stdout: string;
      stderr: string;
    }) => `exit code: ${exitCode}\n\nstdout:\n${stdout}\n\nstderr:\n${stderr}`;
    const presentCommand = (errorText: string) =>
      presentLangyToolError({
        title: "Running a command on your machine",
        errorText,
        toolName: "local_bash",
      });

    /** uv's progress bars and colours, a uv warning, two Python warnings, then the traceback. */
    const uvPythonImportFailure = shellResult({
      exitCode: "1",
      stdout: "(empty)",
      stderr: [
        `${ESC}[2mResolved ${ESC}[1m42 packages${ESC}[0m ${ESC}[2min 1.21s${ESC}[0m`,
        `${ESC}[?25l⠙ Preparing packages... (0/3)\r${ESC}[2K⠹ Preparing packages... (1/3)`,
        `numpy==2.1.3 ${ESC}[32m━━━━━━${ESC}[2m━━━━${ESC}[0m 4.1 MiB/16.0 MiB\r${ESC}[2K${ESC}[1A${ESC}[2K${ESC}[?25h`,
        `${ESC}[2mInstalled ${ESC}[1m3 packages${ESC}[0m ${ESC}[2min 120ms${ESC}[0m`,
        `${ESC}[33mwarning${ESC}[0m${ESC}[1m:${ESC}[0m \`VIRTUAL_ENV=/Users/ada/.venv\` does not match the project environment path \`.venv\` and will be ignored`,
        "/Users/ada/acme-app/.venv/lib/python3.13/site-packages/pydantic/_internal/_config.py:345: UserWarning: Valid config keys have changed in V2:",
        "  warnings.warn(message, UserWarning)",
        "DeprecationWarning: pkg_resources is deprecated as an API",
        "Traceback (most recent call last):",
        '  File "/Users/ada/acme-app/main.py", line 3, in <module>',
        "    from langwatch import connect_agent",
        "ImportError: cannot import name 'connect_agent' from 'langwatch' (/Users/ada/acme-app/.venv/lib/python3.13/site-packages/langwatch/__init__.py)",
      ].join("\n"),
    });

    /** uv refusing to resolve, with an OSC hyperlink and a warning before the error. */
    const uvResolutionFailure = shellResult({
      exitCode: "2",
      stdout: "",
      stderr: [
        `${ESC}[1m${ESC}[33mwarning${ESC}[0m${ESC}[1m:${ESC}[0m No \`requires-python\` value found in the workspace. Defaulting to \`>=3.14\`.`,
        `  ${ESC}[31m×${ESC}[0m No solution found when resolving dependencies:`,
        `  ╰─▶ Because all versions of langwatch>=1.4.0 require Python<3.14 and you require ${ESC}]8;;https://pypi.org/project/langwatch/${ESC}\\langwatch>=1.4.0${ESC}]8;;${ESC}\\, we can conclude that your requirements are unsatisfiable.`,
      ].join("\n"),
    });

    /** @scenario "A failed command says its exit code and its last error line" */
    it("says the exit code the command stopped with", () => {
      expect(presentCommand(uvPythonImportFailure).message).toBe(
        "The command stopped with exit code 1.",
      );
      expect(presentCommand(uvResolutionFailure).message).toBe(
        "The command stopped with exit code 2.",
      );
    });

    /** @scenario "A failed command says its exit code and its last error line" */
    it("shows the last error line the command printed, past every warning", () => {
      expect(presentCommand(uvPythonImportFailure).detail).toBe(
        "ImportError: cannot import name 'connect_agent' from 'langwatch' (/Users/ada/acme-app/.venv/lib/python3.13/site-packages/langwatch/__init__.py)",
      );
      expect(presentCommand(uvResolutionFailure).detail).toBe(
        "Because all versions of langwatch>=1.4.0 require Python<3.14 and you require langwatch>=1.4.0, we can conclude that your requirements are unsatisfiable.",
      );
    });

    /** @scenario "A failed command says its exit code and its last error line" */
    it("keeps the details free of every terminal escape and overwritten progress line", () => {
      const raw = presentCommand(uvPythonImportFailure).raw ?? "";
      expect(raw).not.toContain(ESC);
      expect(raw).not.toContain("\r");
      expect(raw).not.toContain("Preparing packages");
      expect(raw).toContain("Resolved 42 packages in 1.21s");
      expect(raw).toContain("Traceback (most recent call last):");
      expect(presentCommand(uvResolutionFailure).raw).not.toContain(ESC);
      expect(presentCommand(uvResolutionFailure).raw).not.toContain("8;;");
    });

    /** @scenario "A failed command says its exit code and its last error line" */
    it("reads the same way for a folder-bound shell call that arrives named bash", () => {
      const presentation = presentLangyToolError({
        title: "Running a command",
        errorText: uvPythonImportFailure,
        toolName: "bash",
      });
      expect(presentation.message).toBe("The command stopped with exit code 1.");
      expect(presentation.detail).toMatch(/^ImportError: cannot import name 'connect_agent'/);
    });

    it("leaves a sandbox shell failure, which the sandbox writes its own way, on its old card", () => {
      const sandbox = presentLangyToolError({
        title: "Running a command",
        errorText: "ImportError: cannot import name 'x'\n\nCommand exited with code 1",
        toolName: "bash",
      });
      expect(sandbox.message).toBe("This step couldn't be completed.");
      expect(sandbox.detail).toBeUndefined();
    });

    it("drops a string sequence's payload, terminated or cut off", () => {
      const raw =
        presentCommand(
          shellResult({
            exitCode: "1",
            stdout: "(empty)",
            stderr: `${ESC}P1$r0m${ESC}\\error: Failed to spawn: \`python3.14\`\n${ESC}]0;uv run main.py`,
          }),
        ).raw ?? "";
      expect(raw).toContain("error: Failed to spawn: `python3.14`");
      expect(raw).not.toContain(ESC);
      expect(raw).not.toContain("1$r0m");
      expect(raw).not.toContain("uv run main.py");
    });

    it("says the exit code alone when the command printed nothing", () => {
      const presentation = presentCommand(
        shellResult({ exitCode: "127", stdout: "(empty)", stderr: "(empty)" }),
      );
      expect(presentation.message).toBe("The command stopped with exit code 127.");
      expect(presentation.detail).toBeUndefined();
    });

    it("says the command stopped without an exit code when it was killed", () => {
      const presentation = presentCommand(
        shellResult({ exitCode: "none", stdout: "(empty)", stderr: "Killed" }),
      );
      expect(presentation.message).toBe("The command stopped without an exit code.");
      expect(presentation.detail).toBe("Killed");
    });

    it("reads the error from stdout when stderr is empty", () => {
      const presentation = presentCommand(
        shellResult({
          exitCode: "1",
          stdout: "collected 3 items\nFAILED tests/test_agent.py::test_reply - AssertionError",
          stderr: "(empty)",
        }),
      );
      expect(presentation.detail).toBe("FAILED tests/test_agent.py::test_reply - AssertionError");
    });
  });

  describe("given the sandbox's own gh with no login", () => {
    const ghOutput = [
      "To get started with GitHub CLI, please run: gh auth login",
      "Alternatively, populate the GH_TOKEN environment variable.",
    ].join("\n");

    const presentGh = () =>
      presentLangyToolError({
        title: "Running a command",
        errorText: ghOutput,
        toolName: "bash",
      });

    /** @scenario "The sandbox's own gh never tells the customer to log in" */
    it("says the LangWatch GitHub App is not installed", () => {
      expect(presentGh().title).toBe("Install the GitHub App to continue");
      expect(presentGh().message).toContain("GitHub App");
    });

    /** @scenario "The sandbox's own gh never tells the customer to log in" */
    it("carries the code for a missing GitHub App and points at Settings", () => {
      expect(presentGh().code).toBe("langy_github_not_connected");
      expect(presentGh().tips?.join(" ")).toContain("Integrations");
    });

    /** @scenario "The sandbox's own gh never tells the customer to log in" */
    it("never repeats the instruction as card copy", () => {
      const presentation = presentGh();
      expect(presentation.message).not.toContain("gh auth login");
      expect(presentation.detail).toBeUndefined();
      // The engine's own words stay behind the disclosure, as they always do.
      expect(presentation.raw).toContain("gh auth login");
    });
  });

  describe("given the developer's own gh in the shared folder", () => {
    /** @scenario "A shell command that ran in the shared folder keeps gh's own instruction" */
    it("shows what gh said and claims no missing App, while an unmarked shell still does", () => {
      const ghOutput = "To get started with GitHub CLI, please run: gh auth login";
      const shared = presentLangyToolError({
        title: "Running a command",
        errorText: ghOutput,
        toolName: "local_bash",
      });
      const unmarked = presentLangyToolError({
        title: "Running a command",
        errorText: ghOutput,
        toolName: "bash",
      });

      expect(shared.detail).toContain("gh auth login");
      expect(shared.title).not.toContain("GitHub App");
      expect(shared.message).not.toContain("GitHub App");
      expect(shared.code).toBeUndefined();
      expect(unmarked.code).toBe("langy_github_not_connected");
      expect(unmarked.title).toBe("Install the GitHub App to continue");
    });

    /** @scenario "The developer's own gh keeps its own instruction" */
    it("keeps gh's instruction, because that shell is theirs", () => {
      const presentation = presentLangyToolError({
        title: "Running a command",
        errorText: "To get started with GitHub CLI, please run: gh auth login",
        toolName: "local_bash",
      });

      expect(presentation.code).toBeUndefined();
      expect(presentation.detail).toContain("gh auth login");
    });
  });

  describe("given the failures the card reads in whole", () => {
    /** @scenario "A failure with nothing to add still says something useful" */
    it("names what failed, shows the text it was given and claims no code", () => {
      const presentation = present("✖ Failed to reach the API: socket hang up (ECONNRESET)");

      expect(presentation.title).toBe("Creating scenario failed");
      expect(presentation.detail).toBe("Failed to reach the API: socket hang up (ECONNRESET)");
      expect(presentation.code).toBeUndefined();
    });

    /** @scenario "A failure the card has copy for still shows its code" */
    it("explains a known failure in its words and still shows the platform's code", () => {
      const presentation = present(
        failureDocument({
          code: "dataset_not_found",
          message: "Dataset support-questions does not exist",
          httpStatus: 404,
          meta: {},
          isHandled: true,
        }),
        "Loading dataset",
      );

      expect(presentation.message).toBe("Dataset support-questions does not exist");
      expect(presentation.code).toBe("dataset_not_found");
    });

    /** @scenario "A failure the card has no copy for names itself" */
    it("shows what the platform said about an unseen failure and its code", () => {
      const presentation = present(
        failureDocument({
          code: "clickhouse_unavailable",
          message: "Analytics storage is temporarily unavailable.",
          httpStatus: 503,
          meta: {},
          isHandled: false,
        }),
        "Counting traces",
      );

      expect(presentation.message).toBe("Analytics storage is temporarily unavailable.");
      expect(presentation.code).toBe("clickhouse_unavailable");
    });
  });
});
