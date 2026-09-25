// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * A source type hidden from the menu keeps its mark on configured rows.
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SourceTypeIconGlyph } from "../ui/elements/source-type-icon-glyph.tsx";

afterEach(cleanup);

describe("given a source type that was offered before it worked", () => {
  /** @scenario "Sources already configured on an unread type still display" */
  it("still draws its icon for sources configured on it", () => {
    const { container } = render(
      <ChakraProvider value={defaultSystem}>
        <SourceTypeIconGlyph sourceType="openai_compliance" />
      </ChakraProvider>,
    );

    expect(container.querySelector("svg")).not.toBeNull();
  });
});
