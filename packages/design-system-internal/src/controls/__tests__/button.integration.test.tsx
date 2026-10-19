// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "../button.tsx";

afterEach(() => cleanup());

describe("<Button/>", () => {
  describe("when pressed is given", () => {
    it("is a toggle carrying aria-pressed", () => {
      render(
        <>
          <Button pressed>Notify</Button>
          <Button pressed={false}>Follow</Button>
        </>,
      );

      expect(screen.getByRole("button", { name: "Notify", pressed: true })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Follow", pressed: false })).toBeTruthy();
    });
  });

  describe("when pressed is not given", () => {
    it("is a plain button", () => {
      render(<Button>Restart</Button>);

      expect(screen.getByRole("button", { name: "Restart" }).hasAttribute("aria-pressed")).toBe(
        false,
      );
    });
  });
});
