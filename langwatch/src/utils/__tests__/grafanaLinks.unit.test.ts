import { describe, it, expect } from "vitest";
import {
  grafanaTraceUrl,
  grafanaLogsUrlByTrace,
  grafanaLinksForTrace,
} from "../grafanaLinks";

const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";

// Parse the `panes` query param back into the object Grafana Explore reads, so
// the assertions are about the actual decoded structure, not string fragments.
// url is non-null for the valid-base cases; assert before decoding.
const panesOf = (url: string | null) => {
  expect(url).not.toBeNull();
  const parsed = new URL(url!);
  const panes = parsed.searchParams.get("panes");
  return { parsed, panes: JSON.parse(panes ?? "{}") };
};

describe("grafanaTraceUrl", () => {
  describe("given a base URL and a trace id", () => {
    it("targets Grafana Explore with the Tempo datasource and the trace id as a TraceQL query", () => {
      const url = grafanaTraceUrl(TRACE_ID, {
        baseUrl: "http://127.0.0.1:3000",
      });
      const { parsed, panes } = panesOf(url);

      expect(parsed.origin + parsed.pathname).toBe("http://127.0.0.1:3000/explore");
      expect(parsed.searchParams.get("schemaVersion")).toBe("1");

      const pane = panes.lw;
      expect(pane.datasource).toBe("tempo");
      expect(pane.queries[0].datasource).toEqual({ type: "tempo", uid: "tempo" });
      expect(pane.queries[0].queryType).toBe("traceql");
      expect(pane.queries[0].query).toBe(TRACE_ID);
    });
  });

  describe("when a production Grafana overrides the datasource uid", () => {
    it("uses the provided Tempo uid", () => {
      const url = grafanaTraceUrl(TRACE_ID, {
        baseUrl: "https://grafana.example.com",
        tempoDatasourceUid: "prod-tempo",
      });
      const { parsed, panes } = panesOf(url);

      expect(parsed.origin).toBe("https://grafana.example.com");
      expect(panes.lw.queries[0].datasource.uid).toBe("prod-tempo");
    });
  });

  describe("when the base URL already has a trailing slash", () => {
    it("does not double the slash before /explore", () => {
      const url = grafanaTraceUrl(TRACE_ID, { baseUrl: "http://127.0.0.1:3000/" });
      expect(url).not.toBeNull();
      expect(new URL(url!).pathname).toBe("/explore");
    });
  });

  describe("when the base URL is malformed (a bare host with no scheme)", () => {
    it("fails closed to null instead of throwing on the error path", () => {
      // A bad GRAFANA_BASE_URL must not turn a handled error into a second throw.
      expect(grafanaTraceUrl(TRACE_ID, { baseUrl: "127.0.0.1:3000" })).toBeNull();
      expect(grafanaLogsUrlByTrace(TRACE_ID, { baseUrl: "127.0.0.1:3000" })).toBeNull();
    });
  });
});

describe("grafanaLogsUrlByTrace", () => {
  it("targets the Loki datasource with a LogQL filter on the trace id", () => {
    const url = grafanaLogsUrlByTrace(TRACE_ID, { baseUrl: "http://127.0.0.1:3000" });
    const { panes } = panesOf(url);

    expect(panes.lw.datasource).toBe("loki");
    expect(panes.lw.queries[0].datasource).toEqual({ type: "loki", uid: "loki" });
    expect(panes.lw.queries[0].expr).toContain(TRACE_ID);
    expect(panes.lw.queries[0].expr).toContain("trace_id");
  });
});

describe("grafanaLinksForTrace", () => {
  describe("when a base URL and trace id are present", () => {
    it("returns both a trace and a logs link", () => {
      const links = grafanaLinksForTrace(TRACE_ID, {
        baseUrl: "http://127.0.0.1:3000",
      });
      expect(links).not.toBeNull();
      expect(links!.traceUrl).toContain("/explore");
      expect(links!.logsUrl).toContain("/explore");
    });
  });

  describe("when there is no base URL (no observability stack)", () => {
    it("returns null so callers fall back to plain ids", () => {
      expect(grafanaLinksForTrace(TRACE_ID, { baseUrl: undefined })).toBeNull();
      expect(grafanaLinksForTrace(TRACE_ID, {})).toBeNull();
    });
  });

  describe("when there is no trace id", () => {
    it("returns null", () => {
      expect(
        grafanaLinksForTrace(undefined, { baseUrl: "http://127.0.0.1:3000" }),
      ).toBeNull();
    });
  });

  describe("when the base URL is malformed", () => {
    it("returns null so a bad env value can't throw through the error handler", () => {
      expect(
        grafanaLinksForTrace(TRACE_ID, { baseUrl: "127.0.0.1:3000" }),
      ).toBeNull();
    });
  });
});
