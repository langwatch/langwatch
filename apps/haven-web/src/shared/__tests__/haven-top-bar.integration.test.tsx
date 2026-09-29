// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://feat-x.langwatch.localhost/"}
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { surfacesFor } from "../../__fixtures__/daemon.ts";
import { HavenTopBar } from "../haven-top-bar.tsx";

afterEach(() => cleanup());

const labels = () =>
  within(screen.getByRole("navigation", { name: "Consoles" }))
    .getAllByRole("link")
    .map((link) => [link.textContent, link.getAttribute("aria-current")]);

describe("<HavenTopBar/>", () => {
  describe("given a stack's home on its own host", () => {
    it("takes the kit's consoles that answer, then appends Logs and Grafana", () => {
      render(
        <HavenTopBar
          current="home"
          hubHref="https://hub.langwatch.localhost"
          home={{
            slug: "feat-x",
            href: "https://feat-x.langwatch.localhost",
            surfaces: surfacesFor({ slug: "feat-x" }),
          }}
        />,
      );

      expect(labels()).toEqual([
        ["Home", "page"],
        ["Hub", null],
        ["App", null],
        ["Mail", null],
        ["IdP", null],
        ["Logs", null],
        ["Grafana", null],
      ]);
      expect(screen.getByRole("link", { name: "Logs" }).getAttribute("href")).toBe(
        "https://hub.langwatch.localhost/logs/feat-x",
      );
    });
  });
});
