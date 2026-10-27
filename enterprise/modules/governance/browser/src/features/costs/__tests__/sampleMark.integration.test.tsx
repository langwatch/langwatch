// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The `sample` mark on one invented panel: present where nothing else says the
 * figures are invented, absent where the screen's banner already has.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { SampleMark, SampleSaidOnce } from "../ui/elements/sample-mark.tsx";

const renderInChakra = (element: ReactElement) => renderWithDesignSystem(element);

afterEach(() => cleanup());

describe("the sample mark", () => {
  describe("given an invented panel with no sample banner above it", () => {
    /** @scenario "The sample mark returns wherever no banner speaks for it" */
    it("shows, because nothing else on the screen says the figures are invented", () => {
      renderInChakra(
        <SampleSaidOnce said={false}>
          <SampleMark shown />
        </SampleSaidOnce>,
      );

      expect(screen.getByText("sample")).toBeInTheDocument();
    });
  });

  describe("given the banner already says nothing on the screen is real", () => {
    it("stands down rather than repeating it", () => {
      renderInChakra(
        <SampleSaidOnce said>
          <SampleMark shown />
        </SampleSaidOnce>,
      );

      expect(screen.queryByText("sample")).toBeNull();
    });
  });

  describe("given a panel drawing measured figures", () => {
    it("is not drawn", () => {
      renderInChakra(<SampleMark shown={false} />);

      expect(screen.queryByText("sample")).toBeNull();
    });
  });
});
