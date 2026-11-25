/**
 * The content column: one readable width, centred on the whole page.
 * @vitest-environment jsdom
 * @see specs/features/agent-testing/page-structure.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  CONTENT_COLUMN_MAX_WIDTH,
  CONTENT_COLUMN_WIDE_MAX_WIDTH,
  ContentColumn,
} from "../content-column.tsx";

describe("the content column", () => {
  afterEach(cleanup);

  /** @scenario The content is held to a column and centred on the page */
  it("holds the content to one readable centred column", () => {
    renderWithDesignSystem(
      <ContentColumn>
        <div>the content</div>
      </ContentColumn>,
    );

    const column = screen.getByText("the content").parentElement!;
    expect(column).toHaveStyle({
      maxWidth: CONTENT_COLUMN_MAX_WIDTH,
      marginInline: "auto",
    });
  });

  /** @scenario "A surface with no rail takes the width the rail would have used" */
  it("takes the wider column and pays nothing back when it has no rail", () => {
    renderWithDesignSystem(
      <ContentColumn columnMaxWidth={CONTENT_COLUMN_WIDE_MAX_WIDTH}>
        <div>the content</div>
      </ContentColumn>,
    );

    const column = screen.getByText("the content").parentElement!;
    expect(column).toHaveStyle({
      maxWidth: CONTENT_COLUMN_WIDE_MAX_WIDTH,
      marginInline: "auto",
    });
    expect(Number.parseInt(CONTENT_COLUMN_WIDE_MAX_WIDTH, 10)).toBeGreaterThan(
      Number.parseInt(CONTENT_COLUMN_MAX_WIDTH, 10),
    );
  });
});
