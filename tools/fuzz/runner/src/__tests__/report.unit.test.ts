import { describe, expect, it } from "vitest";

import { classifyEvent } from "../oracles.ts";
import { oracleOf, routeLabel, signatureOf, trailLine } from "../report.ts";

describe("report", () => {
  it("writes a route as the README does", () => {
    expect(routeLabel("/:project/datasets/:id")).toBe("/[project]/datasets/[id]");
  });

  it("writes trail steps a person can replay", () => {
    expect(trailLine({ n: 0, action: "open", target: "/p/traces", url: "" })).toBe(
      "goto /p/traces",
    );
    expect(trailLine({ n: 1, action: "click", target: 'button "New"', url: "" })).toBe(
      'click button "New"',
    );
    expect(trailLine({ n: 2, action: "escape", url: "" })).toBe("press Escape");
    expect(
      trailLine({
        n: 3,
        action: "fill",
        target: 'input "Name"',
        value: 'huge(5):"AAAAA"',
        url: "",
      }),
    ).toBe('fill input "Name" huge(5):"AAAAA"');
  });

  it("names the README's oracle and its signature form", () => {
    const draft = classifyEvent({
      origin: "https://app.test",
      event: { type: "pageerror", message: "x is not a function" },
    });
    expect(draft && oracleOf(draft.kind)).toBe("page-error");
    expect(draft && signatureOf(draft)).toBe("page-error :: x is not a function");
    const server = classifyEvent({
      origin: "https://app.test",
      event: {
        type: "response",
        status: 500,
        method: "GET",
        url: "https://app.test/api/x",
        resourceType: "fetch",
      },
    });
    expect(server && signatureOf(server)).toBe("network-5xx :: 500 GET /api/x");
  });
});
