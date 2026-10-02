import { afterAll, describe, expect, it } from "vitest";

import { queryDataInStateRule } from "../../src/rules/query-data-in-state.rule.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { browser: {} } } },
});

afterAll(() => workspace.cleanup());

const FILE = "modules/agent/browser/src/behavior/use-thing.ts";

function report(body, filename = FILE) {
  const code = `function useThing(client) {\n${body}\n}`;

  return runRule(queryDataInStateRule, { code, cwd: workspace.cwd, filename }).map(
    ({ data, line, messageId }) => ({ line, messageId, origin: data.origin }),
  );
}

describe("given a component reading a query", () => {
  describe("when the query data seeds useState", () => {
    it("reports queryCopiedToState for the result object and for destructured data", () => {
      expect(
        report("const q = client.thing.list.useQuery({});\nconst [rows] = useState(q.data ?? []);"),
      ).toEqual([{ line: 3, messageId: "queryCopiedToState", origin: "useState" }]);
      expect(
        report(
          "const { data: thing } = client.thing.get.useQuery({});\nconst [x] = useState(() => thing?.name);",
        ),
      ).toEqual([{ line: 3, messageId: "queryCopiedToState", origin: "useState" }]);
    });
  });

  describe("when an effect sets state from the query data", () => {
    it("reports the setter call", () => {
      const found = report(
        "const q = client.thing.list.useQuery({});\nconst [rows, setRows] = useState([]);\nuseEffect(() => {\n  log();\n  setRows(q.data?.items);\n}, [q.data]);",
      );

      expect(found).toEqual([
        { line: 6, messageId: "queryCopiedToState", origin: "setRows in an effect" },
      ]);
    });
  });

  describe("when an effect accumulates pages with a functional updater", () => {
    const prelude =
      "const q = client.thing.list.useQuery({});\nconst [pages, setPages] = useState([]);\n";

    it("leaves the updater alone", () => {
      const body = "useEffect(() => { setPages((prev) => [...prev, q.data]); }, [q.data]);";

      expect(report(prelude + body)).toEqual([]);
    });

    it("still reports a plain copy and a parameterless updater", () => {
      for (const copy of ["setPages(q.data)", "setPages(() => q.data)"]) {
        const found = report(`${prelude}useEffect(() => { ${copy}; }, [q.data]);`);

        expect(found).toHaveLength(1);
      }
    });
  });

  describe("when state is not seeded from a query", () => {
    it("leaves other state, handlers and derived reads alone", () => {
      const prelude =
        "const q = client.thing.list.useQuery({});\nconst [draft, setDraft] = useState('');\n";
      const bodies = [
        "const [open] = useState(false);",
        "const other = useOther({});\nconst [x] = useState(other.data);",
        "const onEdit = () => setDraft(q.data.name);",
        "useEffect(() => { setDraft('x'); }, [q.data]);",
        "const rows = q.data?.items ?? [];",
      ];

      for (const body of bodies) expect(report(prelude + body)).toEqual([]);
    });
  });

  describe("when the file is a test", () => {
    it("is not governed", () => {
      const body = "const q = c.a.useQuery({});\nconst [r] = useState(q.data);";

      expect(report(body, "modules/agent/browser/src/__tests__/a.unit.test.ts")).toEqual([]);
    });
  });
});
