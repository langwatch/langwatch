import { afterAll, describe, expect, it } from "vitest";

import { noRawErrorMessageInUiRule } from "../../src/rules/no-raw-error-message-in-ui.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: {
    agent: { layoutVersion: 0, roles: { browser: {}, process: {} } },
  },
});

afterAll(() => workspace.cleanup());

const BROWSER = "modules/agent/browser/src/ui/panel.tsx";

function report(code, filename = BROWSER) {
  return runRule(noRawErrorMessageInUiRule, { code, cwd: workspace.cwd, filename });
}

describe("given a browser file", () => {
  describe("when a caught error's message is a JSX child", () => {
    /** @scenario "A catch parameter's message in JSX is reported" */
    it("reports rawErrorMessage", () => {
      const found = report(
        "function Panel() { try { run(); } catch (error) { return <p>{error.message}</p>; } }",
      );

      expect(found.map((finding) => finding.messageId)).toEqual(["rawErrorMessage"]);
      expect(found[0].data.expression).toBe("error.message");
    });

    it("reports a conditional and a template that carry the message", () => {
      const found = report(
        "function Panel() { try { run(); } catch (err) {" +
          " return <p>{err instanceof Error ? err.message : 'x'} {`Failed: ${err.message}`}</p>; } }",
      );

      expect(found).toHaveLength(2);
    });
  });

  describe("when the message is a JSX attribute", () => {
    /** @scenario "A message in a JSX attribute is reported" */
    it("reports rawErrorMessage naming the attribute", () => {
      const found = report(
        "function Panel() { try { run(); } catch (e) { return <Alert title={e.message} onClose={() => e.message} />; } }",
      );

      expect(found.map((finding) => finding.data.sink)).toEqual(["the `title` attribute"]);
    });
  });

  describe("when the message reaches a toast", () => {
    /** @scenario "A message in a toast is reported" */
    it("reports an onError parameter and a catch callback", () => {
      const found = report(
        "mutation.mutate(input, { onError: (error) => toaster.create({ title: 'Failed', description: error.message }) });\n" +
          "load().catch((e) => toast({ description: e.message }));",
      );

      expect(found.map((finding) => finding.data.sink)).toEqual(["a toast", "a toast"]);
    });
  });

  describe("when the message is stored with a setter", () => {
    /** @scenario "A message stored with a setter is reported" */
    it("reports the setter", () => {
      const found = report(
        "function Panel() { const [text, setText] = useState('');" +
          " const go = async () => { try { await run(); } catch (error) { setText(error.message); } }; }",
      );

      expect(found.map((finding) => finding.data.sink)).toEqual([
        "`setText`, which the screen renders",
      ]);
    });
  });

  describe("when the error comes from a query or a mutation", () => {
    /** @scenario "A react-query error and a direct alias are reported" */
    it("reports a member error, a hook result error and an alias", () => {
      const found = report(
        "function Panel() {\n" +
          "  const mutation = api.thing.useMutation();\n" +
          "  const { error } = useQuery();\n" +
          "  const { error: failure } = useThing();\n" +
          "  const text = failure.message;\n" +
          "  return <div>{mutation.error.message}{error?.message}{text}</div>;\n" +
          "}",
      );

      expect(found.map((finding) => finding.data.expression)).toEqual([
        "mutation.error.message",
        "error?.message",
        "text",
      ]);
    });
  });

  describe("when the message is a local parse failure or plain data", () => {
    /** @scenario "A message that is only compared or logged is accepted" */
    it("accepts a SyntaxError check, a form field error and a data error", () => {
      const found = report(
        "function Panel({ trace, fieldState }) { try { JSON.parse(x); } catch (err) {" +
          " return <p>{err instanceof SyntaxError ? err.message : 'Invalid'}{fieldState.error?.message}{trace.error.message}</p>; } }",
      );

      expect(found).toEqual([]);
    });
  });

  describe("when the error goes through the shared helpers", () => {
    /** @scenario "An error read through the shared helpers is accepted" */
    it("reports nothing", () => {
      const found = report(
        "function Panel() { const { error } = useQuery();" +
          " try { run(); } catch (e) { showErrorToast({ error: e, fallbackTitle: 'x' }); return <p>{describeError({ error: e })}</p>; }" +
          " return <p>{describeError({ error })}</p>; }",
      );

      expect(found).toEqual([]);
    });
  });

  describe("when the message is only compared, logged or not an error's", () => {
    /** @scenario "A message that is only compared or logged is accepted" */
    it("reports nothing", () => {
      const found = report(
        "function Panel({ draft }) { try { run(); } catch (error) {" +
          " if (error.message.includes('x')) retry();" +
          " console.error(error.message);" +
          " return <p>{draft.message}{error.message ? <A /> : null}</p>; } }",
      );

      expect(found).toEqual([]);
    });
  });
});

describe("given a browser file that reaches the error indirectly", () => {
  describe("when the caught error is aliased or cast", () => {
    /** @scenario "An alias or cast of a caught error is still an error" */
    it("reports the alias's message", () => {
      const found = report(
        "function Panel() { const [m, setM] = useState(''); const go = async () => {" +
          " try { await run(); } catch (e) { const err = e as Error; setM(err.message); } }; }",
      );

      expect(found.map((finding) => finding.data.expression)).toEqual(["err.message"]);
    });
  });

  describe("when the caught error is stringified", () => {
    /** @scenario "A stringified caught error is reported" */
    it("reports String(), a template, a concatenation and toString()", () => {
      const found = report(
        "function Panel() { const [m, setM] = useState(''); try { run(); } catch (e) {" +
          " setM(String(e)); setM(`Failed: ${e}`); setM('Failed: ' + e); return <p>{e.toString()}</p>; } }",
      );

      expect(found.map((finding) => finding.data.expression)).toEqual([
        "String(e)",
        "e",
        "e",
        "e.toString()",
      ]);
    });

    it("accepts a stringified error that is only logged", () => {
      const found = report(
        "function Panel() { try { run(); } catch (e) { console.error(`Failed: ${e}`, String(e)); } }",
      );

      expect(found).toEqual([]);
    });
  });

  describe("when the message is destructured", () => {
    /** @scenario "A destructured message is reported" */
    it("reports the destructured binding", () => {
      const found = report(
        "function Panel() { try { run(); } catch (e) { const { message } = e; return <p>{message}</p>; }" +
          " try { run(); } catch ({ message: text }) { toast({ description: text }); } }",
      );

      expect(found.map((finding) => finding.data.expression)).toEqual(["message", "text"]);
    });
  });
});

describe("given a file that is not browser code", () => {
  describe("when it renders an error's message", () => {
    /** @scenario "Files outside browser code are not governed" */
    it("reports nothing for a process file and a browser test", () => {
      const code =
        "function P() { try { run(); } catch (error) { return <p>{error.message}</p>; } }";

      expect(report(code, "modules/agent/process/src/panel.tsx")).toEqual([]);
      expect(report(code, "modules/agent/browser/src/ui/__tests__/panel.test.tsx")).toEqual([]);
    });
  });

  describe("when a shared package renders the message", () => {
    /** @scenario "A shared package's component is governed like browser code" */
    it("reports rawErrorMessage", () => {
      const code =
        "function P() { try { run(); } catch (error) { return <p>{error.message}</p>; } }";

      expect(
        report(code, "packages/design-system/src/panel.tsx").map((finding) => finding.messageId),
      ).toEqual(["rawErrorMessage"]);
    });
  });

  describe("when the mail templates' local preview renders it", () => {
    /** @scenario "The mail templates' local preview is not governed" */
    it("reports nothing", () => {
      const code =
        "function P() { try { run(); } catch (error) { return <p>{error.message}</p>; } }";

      expect(report(code, "packages/mail/preview/main.tsx")).toEqual([]);
    });
  });
});

describe("given a finding", () => {
  describe("when it is rendered", () => {
    /** @scenario "A finding says what to do instead" */
    it("names showErrorToast and the registry", () => {
      const [finding] = report(
        "function P() { try { run(); } catch (error) { return <p>{error.message}</p>; } }",
      );

      expect(finding.message).toContain("showErrorToast");
      expect(finding.message).toContain("registry keyed by code");
    });
  });
});

describe("given a browser file that renders a typed failure value", () => {
  describe("when its text is a JSX child or attribute", () => {
    /** @scenario "A typed failure value's text in JSX is reported" */
    it("reports a member error, a named error and a result's error", () => {
      const found = report(
        "function View({ run, queryError, result }) {" +
          " return <><p>{run.error.message}</p><Face message={face.failure.message} />" +
          "<p>{queryError.message}</p><p>{result.error}</p></>; }",
      );

      expect(found.map((finding) => finding.data.expression)).toEqual([
        "run.error.message",
        "face.failure.message",
        "queryError.message",
        "result.error",
      ]);
    });
  });

  describe("when the text is data, a field error, or a result's error outside JSX", () => {
    /** @scenario "Recorded exceptions, field errors and a result's error outside JSX are accepted" */
    it("reports nothing", () => {
      const found = report(
        "function View({ trace, ctx, fieldState, result }) {" +
          " if (result.error) toaster.create({ description: result.error });" +
          " return <><p>{trace.error.message}</p><p>{ctx.detail.error.message}</p>" +
          "<p>{fieldState.error?.message}</p><p>{getFieldState('a').error?.message}</p>" +
          "<p>{error.message}</p><p>{parseFailure instanceof SyntaxError ? parseFailure.message : ''}</p></>; }",
      );

      expect(found).toEqual([]);
    });
  });
});

describe("given a react-hook-form bridge", () => {
  describe("when a caught error's message is handed to form.setError", () => {
    /** @scenario "A message handed to form.setError is reported" */
    it("reports rawErrorMessage naming setError", () => {
      const found = report(
        "async function submit() { try { await save(); } catch (error) {" +
          " form.setError('root.serverError', { type: 'server', message: error.message }); } }",
      );

      expect(found.map((finding) => finding.data.sink)).toEqual([
        "`setError`, which the form renders",
      ]);
    });
  });
});

describe("given a browser file that wraps a caught error's message", () => {
  describe("when a helper, an object or a string method carries it on", () => {
    /** @scenario "A message wrapped in a call is still reported" */
    it("reports each wrapped message", () => {
      const found = report(
        "function Panel() { const [m, setM] = useState(''); try { run(); } catch (err) {" +
          " setM(trim(err.message)); setM(humanize(err.message));" +
          " setM(fn({ message: err.message })); return <p>{err.message.trim()}</p>; } }",
      );

      expect(found.map((finding) => finding.data.expression)).toEqual([
        "err.message",
        "err.message",
        "err.message",
        "err.message",
      ]);
    });

    it("reports a wrapped message in a toast and through String()", () => {
      const found = report(
        "mutation.mutate(i, { onError: (e) => toast({ description: String(e.message ?? '') }) });",
      );

      expect(found.map((finding) => finding.data.sink)).toEqual(["a toast"]);
    });
  });

  describe("when the message is only checked or logged inside a call", () => {
    /** @scenario "A message that only goes through a check or the shared helpers is accepted" */
    it("reports nothing", () => {
      const found = report(
        "function Panel() { const [m, setM] = useState(''); try { run(); } catch (err) {" +
          " console.error(err.message); setM(describeError({ error: err }));" +
          " setM(err.message.includes('x') ? 'a' : 'b'); } }",
      );

      expect(found).toEqual([]);
    });
  });
});

describe("given a browser file with a react-hook-form field error", () => {
  describe("when it is named like a failure but read off form state", () => {
    /** @scenario "A form field error named like a failure is accepted" */
    it("reports nothing", () => {
      const found = report(
        "function Row({ shared, idx, form }) {" +
          " const contentError = shared.getMessageError(idx, 'content');" +
          " const { error: nameError } = form.getFieldState('name');" +
          " const { errors } = useFormContext().formState; const titleError = errors.title;" +
          " return <><p>{String(contentError.message ?? '')}</p><p>{nameError.message}</p><p>{titleError?.message}</p></>; }",
      );

      expect(found).toEqual([]);
    });

    it("still reports a failure named *Error that nothing says is a field error", () => {
      const found = report(
        "function View({ queryError }) { return <p>{trim(queryError.message)}</p>; }",
      );

      expect(found).toHaveLength(1);
    });
  });
});

describe("given a browser file that shows a scenario hook result", () => {
  const BAND =
    "export function Band({ result }: { result: ScenarioHookResult }) {" +
    " return <div>{result.error && <HookError error={result.error} />}</div>; }" +
    " export function Plain(result: ScenarioHookResult) { return <p>{result.error}</p>; }";

  describe("when it renders the error the customer's own hook raised", () => {
    /** @scenario "A scenario hook result's error is the customer's own text and is accepted" */
    it("reports nothing", () => {
      expect(report(BAND)).toEqual([]);
    });

    it("still reports a caught error's message in the same file", () => {
      const found = report(
        `${BAND} function Panel() { try { run(); } catch (e) { return <p>{e.message}</p>; } }`,
      );

      expect(found.map((finding) => finding.data.expression)).toEqual(["e.message"]);
    });

    it("still reports the error of a result not typed as a hook result", () => {
      const found = report(
        "function View({ result }: { result: QueryResult }) { return <p>{result.error}</p>; }",
      );

      expect(found).toHaveLength(1);
    });
  });
});
