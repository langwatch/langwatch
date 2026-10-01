/**
 * @vitest-environment jsdom
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OpsHostProvider } from "../../model/ops-host.ts";
import { FakeOpsHost } from "../../testing.tsx";
import { type OpsRouterTarget, useOpsRouter } from "../ops-router.ts";

function drive({ to, replace }: { to: OpsRouterTarget; replace: boolean }) {
  const host = FakeOpsHost.create({ params: { id: "p" }, query: { id: "q", tab: "a" } });
  const { result } = renderHook(() => useOpsRouter(), {
    wrapper: ({ children }) => <OpsHostProvider value={host}>{children}</OpsHostProvider>,
  });
  if (replace) result.current.replace(to);
  else result.current.push(to);
  return { router: result.current, recording: host.recording };
}

describe("useOpsRouter", () => {
  it("merges path parameters over the query string", () => {
    const { router } = drive({ to: "?x=1", replace: false });
    expect(router.query).toEqual({ id: "p", tab: "a" });
  });

  it.each<[OpsRouterTarget, boolean, string[], { next: object; replace: boolean }[]]>([
    ["?a=1&b=2", true, [], [{ next: { a: "1", b: "2" }, replace: true }]],
    ["/ops/queues", false, ["/ops/queues"], []],
    [{ pathname: "/ops/x" }, false, ["/ops/x"], []],
    [{ pathname: "/ops/x", query: {} }, true, ["/ops/x"], []],
    [{ pathname: "/ops/x", query: { a: null, b: [3, 4], c: "s" } }, false, ["/ops/x?b=3&c=s"], []],
    [
      { query: { a: ["z"], b: undefined, c: { d: 1 } } },
      false,
      [],
      [{ next: { a: "z", b: undefined, c: '{"d":1}' }, replace: false }],
    ],
    [{}, true, [], [{ next: {}, replace: true }]],
  ])("routes %j (replace %s)", (to, replace, navigations, queries) => {
    const { recording } = drive({ to, replace });
    expect(recording.navigations).toEqual(navigations);
    expect(recording.queries).toEqual(queries);
  });
});
