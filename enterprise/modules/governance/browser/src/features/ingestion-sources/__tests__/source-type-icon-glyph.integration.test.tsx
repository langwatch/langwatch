// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * A source type hidden from the menu keeps its mark on configured rows.
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SOURCE_TYPE_OPTIONS } from "../model/ingestion-source-catalog.ts";
import { SourceTypeIconGlyph } from "../ui/elements/source-type-icon-glyph.tsx";

afterEach(cleanup);

describe("given a source type that was offered before it worked", () => {
  /** @scenario "Sources already configured on an unread type still display" */
  it("still draws its icon for sources configured on it", () => {
    const { container } = renderWithDesignSystem(
      <SourceTypeIconGlyph sourceType="openai_compliance" />,
    );

    expect(container.querySelector("svg")).not.toBeNull();
  });
});

describe("given every catalogued source type", () => {
  it.each(SOURCE_TYPE_OPTIONS.map((option) => option.value))(
    "draws a mark for %s",
    (sourceType) => {
      const { container } = renderWithDesignSystem(<SourceTypeIconGlyph sourceType={sourceType} />);

      expect(container.querySelector("svg")).not.toBeNull();
    },
  );
});
