/** @vitest-environment jsdom */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BriefingData, BriefingReceipt } from "../types";
import { LangyBriefing } from "./LangyBriefing";

const receipt: BriefingReceipt = {
  id: "error-shape:rate-limit",
  severity: "error",
  subject: "New error shape",
  detail: "“Provider rate limit” on 4 traces.",
  link: {
    label: "Open traces",
    href: "/acme/traces#all-traces?q=errorMessage%3A%22Provider+rate+limit%22&preset=30d",
  },
  context: {
    id: 'errorMessage:"Provider rate limit"',
    label: "New error shape: Provider rate limit",
    query: 'errorMessage:"Provider rate limit"',
  },
  askPrompt:
    "Investigate this new error shape and separate evidence from hypotheses.",
};

const data: BriefingData = {
  since: "last 30 days",
  headline: "1 signal needs attention.",
  receiptsLabel: "Attention inbox",
  receipts: [receipt],
};

function renderBriefing(props: {
  onInvestigateReceipt?: (item: BriefingReceipt) => void;
}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <LangyBriefing data={data} {...props} />
    </ChakraProvider>,
  );
}

describe("LangyBriefing attention inbox actions", () => {
  it("hands the complete receipt to the investigate action", () => {
    const onInvestigateReceipt = vi.fn();
    renderBriefing({ onInvestigateReceipt });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Investigate New error shape in Langy",
      }),
    );

    expect(onInvestigateReceipt).toHaveBeenCalledWith(receipt);
  });

  it("makes the whole row a link to the Trace Explorer evidence", () => {
    renderBriefing({});

    expect(
      screen
        .getByRole("link", { name: "Open traces for New error shape" })
        .getAttribute("href"),
    ).toBe(receipt.link?.href);
  });

  it("does not render a separate per-row Ask Langy button", () => {
    renderBriefing({ onInvestigateReceipt: vi.fn() });

    expect(
      screen.queryByRole("button", { name: /Ask Langy about/ }),
    ).toBeNull();
  });
});
