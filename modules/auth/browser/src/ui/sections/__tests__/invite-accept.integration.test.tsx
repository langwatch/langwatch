/**
 * @vitest-environment jsdom
 * The invitation link's page: a code-less link says so instead of waiting.
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../behavior/use-route.ts", () => ({
  useRouter: () => ({ query: {} }),
}));

import Accept from "../invite-accept-screen.tsx";

afterEach(() => cleanup());

describe("given the link arrived without its code", () => {
  it("says the link is incomplete instead of waiting forever", () => {
    renderWithDesignSystem(<Accept />);

    expect(screen.getByTestId("invite-incomplete")).toBeTruthy();
    expect(screen.getByText(/invitation link is incomplete/i)).toBeTruthy();
  });
});
