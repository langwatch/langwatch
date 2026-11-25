// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderWithDesignSystem } from "../../../testing/index.tsx";
import { VersionList, type VersionListItem } from "../version-list.tsx";

afterEach(cleanup);

const row = (version: number, item: Partial<VersionListItem>): VersionListItem => ({
  id: `v${version}`,
  version,
  labels: [],
  commitMessage: null,
  author: null,
  authorKind: null,
  createdAtLabel: "today",
  ...item,
});

describe("VersionList", () => {
  /** @scenario "A version list names who wrote each version" */
  it("names the user, an unknown user, an API key and LangWatch", () => {
    renderWithDesignSystem(
      <VersionList
        versions={[
          row(4, { author: { name: "Ada", email: null }, authorKind: "user" }),
          row(3, { authorKind: "user" }),
          row(2, { authorKind: "api_key" }),
          row(1, { authorKind: "system" }),
        ]}
      />,
    );
    for (const name of ["Ada", "Unknown user", "API key", "LangWatch"]) {
      expect(screen.getByText(`${name} · today`)).toBeInTheDocument();
    }
  });
});
