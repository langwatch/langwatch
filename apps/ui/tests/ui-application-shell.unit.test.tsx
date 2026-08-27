import type { PropsWithChildren } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { UiApplicationShell } from "../src/app/ui-application-shell";

let root: Root | undefined;

afterEach(async () => {
  await act(() => root?.unmount());
  root = void 0;
  document.body.replaceChildren();
});

describe("UiApplicationShell", () => {
  it("renders the supplied router inside the supplied outer provider", async () => {
    const router = createMemoryRouter(
      [
        {
          Component: RoutedContent,
          path: "/",
        },
      ],
      { initialEntries: ["/"] },
    );
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(() => {
      root?.render(<UiApplicationShell outerProvider={LegacyOuterProvider} router={router} />);
    });

    expect(container.querySelector("[data-testid='legacy-outer-provider']")).toBeTruthy();
    expect(container.querySelector("[data-testid='routed-content']")?.textContent).toBe(
      "LangWatch",
    );

    router.dispose();
  });
});

function LegacyOuterProvider({ children }: PropsWithChildren) {
  return <section data-testid="legacy-outer-provider">{children}</section>;
}

function RoutedContent() {
  return <main data-testid="routed-content">LangWatch</main>;
}
