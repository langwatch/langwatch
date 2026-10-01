/**
 * @vitest-environment jsdom
 */

import { uiTokens } from "@langwatch/module";
import { render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { UiCapabilityContextProvider } from "../capabilities.ts";
import { type UiDeclarations, type UiLend, uiDeclarations } from "../declarations.ts";
import { Lent, useLent, useLentAll, useLentHooks } from "../lent.ts";
import { createUiCapabilitiesFromHost } from "../testing.ts";

const Peek = uiTokens("trace").component<{ traceId: string }>("traceIdPeek");
const Cards = uiTokens("organization").extension<{ organizationId: string }>("overviewCard");
const Tour = uiTokens("onboarding").hooks<{ useRunning: () => boolean }>("guidedTour");

const host = { route: () => ({ params: {}, query: {} }), navigate: vi.fn() };

function within(declarations: UiDeclarations) {
  return ({ children }: { children: ReactNode }) => (
    <UiCapabilityContextProvider value={{ ...createUiCapabilitiesFromHost(host), declarations }}>
      {children}
    </UiCapabilityContextProvider>
  );
}

function lendsOf(module: string, lends: readonly UiLend[]) {
  return { name: module, installation: { capabilities: {}, lends } };
}

describe("a component lent by token", () => {
  describe("when its owner lends it", () => {
    /** @scenario A lent component renders for its reader */
    it("renders it with the reader's props", async () => {
      const Component = ({ traceId }: { traceId: string }) => <p>peek {traceId}</p>;
      const declarations = uiDeclarations([
        lendsOf("trace", [{ token: Peek, load: () => Promise.resolve({ default: Component }) }]),
      ]);

      render(<Lent of={Peek} props={{ traceId: "t1" }} />, { wrapper: within(declarations) });

      expect(await screen.findByText("peek t1")).toBeDefined();
    });
  });

  describe("when nobody lends it", () => {
    /** @scenario An unlent component reads as nothing */
    it("answers undefined", () => {
      const { result } = renderHook(() => useLent(Peek), { wrapper: within(uiDeclarations([])) });

      expect(result.current).toBeUndefined();
    });
  });
});

describe("an extension point lent by several modules", () => {
  /** @scenario An extension token reads as a list in install order */
  it("answers every lender in install order", () => {
    const load = () => Promise.resolve({ default: () => null });
    const declarations = uiDeclarations([
      lendsOf("scim", [{ token: Cards, load }]),
      lendsOf("sso", [{ token: Cards, load }]),
    ]);

    const { result } = renderHook(() => useLentAll(Cards), { wrapper: within(declarations) });

    expect(result.current.map((entry) => entry.owner)).toEqual(["scim", "sso"]);
  });
});

describe("hooks lent by token", () => {
  /** @scenario Lent hooks arrive as the eager object the owner lent */
  it("answers the owner's value", () => {
    const value = { useRunning: () => true };
    const declarations = uiDeclarations([lendsOf("onboarding", [{ token: Tour, value }])]);

    const { result } = renderHook(() => useLentHooks(Tour), { wrapper: within(declarations) });

    expect(result.current).toBe(value);
  });
});
