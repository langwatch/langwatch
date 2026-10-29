import { describe, expect, it } from "vitest";

import { nestedEntries } from "../ui/toc.tsx";

describe("when the contents rail indents its entries", () => {
  it("keeps entries that open with h3s and close with an h2 on one edge", () => {
    const entries = [
      { depth: 3, text: "MCPs", id: "mcps" },
      { depth: 3, text: "SDKs", id: "sdks" },
      { depth: 2, text: "Request a new integration", id: "request" },
    ];
    expect(nestedEntries({ entries })).toEqual([false, false, false]);
  });

  it("indents an entry beneath a shallower heading", () => {
    const entries = [
      { depth: 2, text: "Setup", id: "setup" },
      { depth: 3, text: "Python", id: "python" },
      { depth: 2, text: "Usage", id: "usage" },
    ];
    expect(nestedEntries({ entries })).toEqual([false, true, false]);
  });
});
