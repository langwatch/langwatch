// @vitest-environment jsdom

import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  StatTile,
  StatTileFigure,
  StatTileGrid,
  StatTileSkeleton,
} from "../src/components/stat-tile.tsx";
import { renderWithDesignSystem } from "../src/testing/index.tsx";

afterEach(() => cleanup());

function fillOf(testId: string) {
  return screen.getByTestId(testId).firstElementChild?.getAttribute("data-fill-ratio");
}

describe("StatTile", () => {
  describe("given a label and a figure", () => {
    it("shows both and no meter", () => {
      renderWithDesignSystem(
        <StatTile label="Traces / month" data-testid="tile">
          <StatTileFigure>184</StatTileFigure>
        </StatTile>,
      );

      expect(screen.getByText("Traces / month")).toBeTruthy();
      expect(screen.getByText("184")).toBeTruthy();
      expect(screen.queryByTestId("tile-meter")).toBeNull();
    });
  });

  describe("given a meter inside its limit", () => {
    it("fills the share of the limit used", () => {
      renderWithDesignSystem(
        <StatTile label="Team members" meter={{ current: 25, max: 100 }} data-testid="tile">
          <StatTileFigure>25 / 100</StatTileFigure>
        </StatTile>,
      );

      expect(fillOf("tile-meter")).toBe("0.25");
    });
  });

  describe("given a meter past its limit", () => {
    it("clamps the fill to a full track", () => {
      renderWithDesignSystem(
        <StatTile label="Team members" meter={{ current: 120, max: 100 }} data-testid="tile">
          <StatTileFigure>120 / 100</StatTileFigure>
        </StatTile>,
      );

      expect(fillOf("tile-meter")).toBe("1");
    });
  });

  describe("given a limit of zero", () => {
    it("draws no meter, since there is no track to fill", () => {
      renderWithDesignSystem(
        <StatTile label="Team members" meter={{ current: 0, max: 0 }} data-testid="tile">
          <StatTileFigure>0 / 0</StatTileFigure>
        </StatTile>,
      );

      expect(screen.queryByTestId("tile-meter")).toBeNull();
    });
  });

  describe("given a hint", () => {
    it("shows it under the figure", () => {
      renderWithDesignSystem(
        <StatTile label="Plan" hint="Renews on the first">
          <StatTileFigure>Growth</StatTileFigure>
        </StatTile>,
      );

      expect(screen.getByText("Renews on the first")).toBeTruthy();
    });
  });
});

describe("StatTileGrid", () => {
  it("renders every tile it is given", () => {
    renderWithDesignSystem(
      <StatTileGrid columns={2}>
        <StatTile label="One">
          <StatTileFigure>1</StatTileFigure>
        </StatTile>
        <StatTile label="Two">
          <StatTileFigure>2</StatTileFigure>
        </StatTile>
      </StatTileGrid>,
    );

    expect(screen.getByText("One")).toBeTruthy();
    expect(screen.getByText("Two")).toBeTruthy();
  });
});

describe("StatTileSkeleton", () => {
  it("is busy, and shows one placeholder per column by default", () => {
    const { container } = renderWithDesignSystem(<StatTileSkeleton columns={3} />);

    const grid = container.querySelector("[aria-busy='true']");
    expect(grid?.children).toHaveLength(3);
  });
});
