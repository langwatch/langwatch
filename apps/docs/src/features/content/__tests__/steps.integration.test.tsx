import { DesignSystemTestProvider } from "@langwatch/design-system/testing";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Step, Steps } from "../ui/steps.tsx";

describe("when steps set a title size", () => {
  /** @scenario "Step titles keep the page's heading order" */
  it("renders step titles at the authored level and h3 by default", () => {
    const sized = renderToStaticMarkup(
      <DesignSystemTestProvider>
        <Steps titleSize="h2">
          <Step title="Create your account">Sign up.</Step>
          <Step title="Read the key" titleSize="p">
            Copy it.
          </Step>
        </Steps>
      </DesignSystemTestProvider>,
    );
    expect(sized).toMatch(/<h2[^>]*>Create your account<\/h2>/);
    expect(sized).toMatch(/<p[^>]*>Read the key<\/p>/);
    const plain = renderToStaticMarkup(
      <DesignSystemTestProvider>
        <Steps>
          <Step title="Install">Run it.</Step>
        </Steps>
      </DesignSystemTestProvider>,
    );
    expect(plain).toMatch(/<h3[^>]*>Install<\/h3>/);
  });
});
