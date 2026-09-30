import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { listNativeSkills, renderSkill } from "../_compiler/native.js";

// Backs specs/langy/langy-dogfood-scenarios.feature: the tracing skill is what
// tells Langy how to prove the instrumentation works. A filmed run asked the
// trace search seven times inside a few seconds, saw nothing, and reported its
// own verification as inconclusive, because the skill said to check and said
// nothing about the ingestion the check waits on.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsRoot = path.resolve(__dirname, "..");

function tracingSkill(): string {
  const skill = listNativeSkills(skillsRoot).find((s) => s.slug === "tracing");
  expect(skill, "tracing is a shipped native skill").toBeTruthy();
  return renderSkill(skill!);
}

describe("given the tracing skill", () => {
  describe("when its instrumentation step is read", () => {
    /** @scenario "LangWatch initialises after the project's environment is loaded" */
    it("puts setup() below the import that loads the environment, in Python and TypeScript", () => {
      const rendered = tracingSkill();
      expect(rendered).toContain("**The environment loads before LangWatch initialises.**");
      expect(rendered).toContain(
        "put `langwatch.setup()` below every import that runs it, never at the top of the entry file",
      );
      expect(rendered).toContain(
        "add `from dotenv import load_dotenv` and `load_dotenv()` at the top of the instrumented entry file, above `import langwatch`",
      );
      expect(rendered).toContain(
        '`import "dotenv/config"` is the first import of the entry file, above the `langwatch` import',
      );
    });

    /** @scenario "LangWatch initialises after the project's environment is loaded" */
    it("checks the key is visible to the process the way the project reads it, without printing it", () => {
      const rendered = tracingSkill();
      expect(rendered).toContain(
        "check that the key is visible to it the way the project reads it",
      );
      expect(rendered).toContain("prints only whether `LANGWATCH_API_KEY` is set, never its value");
      expect(rendered).toContain(
        `python -c "from dotenv import load_dotenv; load_dotenv(); import os; print(bool(os.getenv('LANGWATCH_API_KEY')))"`,
      );
      expect(rendered).toContain(
        `node -e "require('dotenv').config(); console.log(Boolean(process.env.LANGWATCH_API_KEY))"`,
      );
      expect(rendered).toContain("never retry the check with another path");
      expect(rendered).toContain(
        "This is the first and only check: copy the command for the language as written, run it once from the project root",
      );
      expect(rendered).toContain("No variant before it");
      expect(rendered).toContain("Always `-c`, never `python -` with a heredoc");
      expect(rendered).toContain(
        "```bash\nuv run python -c \"from dotenv import load_dotenv; load_dotenv(); import os; print(bool(os.getenv('LANGWATCH_API_KEY')))\"\n```",
      );
    });

    /** @scenario "A LangGraph callback is attached at the graph, not inside a node" */
    it("puts the LangChain callback in the config of the graph invocation", () => {
      const rendered = tracingSkill();
      expect(rendered).toContain(
        "**A graph takes the callback at the graph, not at a model call inside it.**",
      );
      expect(rendered).toContain(
        'graph.invoke(state, config={"callbacks": [langwatch.get_current_trace().get_langchain_callback()]})',
      );
      expect(rendered).toContain("The same config argument works on `ainvoke` and `stream`");
    });

    /** @scenario "A LangGraph callback is attached at the graph, not inside a node" */
    it("says every node becomes a span, and that a callback on one model call leaves the nodes out", () => {
      const rendered = tracingSkill();
      expect(rendered).toContain(
        "Every node the run touches then becomes a span under the trace: a chain span named after the node, LLM spans for the model calls and tool spans for the tool calls.",
      );
      expect(rendered).toContain(
        "Attached only to the model call inside one node, the trace holds LLM spans and nothing else, so the tool nodes and the plain function nodes are missing",
      );
      expect(rendered).toContain(
        "Do NOT attach the LangChain callback only to a model call inside a graph node: it belongs on the graph invocation, or the nodes never become spans",
      );
    });
  });

  describe("when its verification step is read", () => {
    /** @scenario "The tracing skill waits for the trace instead of asking again at once" */
    it("says an empty first answer means the trace has not arrived yet", () => {
      const rendered = tracingSkill();
      expect(rendered).toContain("langwatch trace search");
      expect(rendered).toContain('an empty first answer means "not yet"');
    });

    /** @scenario "The tracing skill waits for the trace instead of asking again at once" */
    it("bounds the retries and says how long to leave between them", () => {
      const rendered = tracingSkill();
      expect(rendered).toContain("up to three times");
      expect(rendered).toContain("twenty seconds apart");
      expect(rendered).toContain("Do not change the command between tries");
    });

    /** @scenario "The tracing skill waits for the trace instead of asking again at once" */
    it("says not to report the change as verified when the wait runs out", () => {
      const rendered = tracingSkill();
      expect(rendered).toContain("do not report the change as verified");
    });
  });
});
