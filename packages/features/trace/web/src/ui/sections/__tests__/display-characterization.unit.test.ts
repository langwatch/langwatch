import { describe, expect, it } from "vitest";
import {
  NON_BILLABLE_ATTR,
  extractPromptReference,
  formatPreview,
  resolveNonBilledCost,
} from "../../../index";

describe("trace display toolkit characterization", () => {
  it("keeps preview unwrap, markdown, and newline-display semantics together", () => {
    expect(
      formatPreview(
        JSON.stringify({
          question: "```python\nprint('hi')\n```\n![chart](https://x.test/a.png)",
        }),
        { maxChars: 80 },
      ),
    ).toEqual({ text: "print('hi') ↵ 📷 chart", hadCode: true, hadImage: true });
  });

  it("keeps folded non-billed cost authoritative and bounded", () => {
    expect(
      resolveNonBilledCost({
        foldedNonBilledCost: 2,
        totalCost: 1,
        attributes: { [NON_BILLABLE_ATTR]: "true" },
      }),
    ).toBe(1);
  });

  it("reads flattened and nested prompt attributes without losing the draft state", () => {
    expect(
      extractPromptReference({
        langwatch: { prompt: { id: "support-router:6", draft: "true" } },
      }),
    ).toMatchObject({ handle: "support-router", versionNumber: 6, draft: true });
  });
});
