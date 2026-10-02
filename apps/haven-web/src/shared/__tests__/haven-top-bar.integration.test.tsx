// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://feat-x.langwatch.localhost/"}
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { hub, surfacesFor } from "../../__fixtures__/daemon.ts";
import { HavenTopBar } from "../haven-top-bar.tsx";

afterEach(() => cleanup());

const nav = () => within(screen.getByRole("navigation", { name: "Consoles" }));

const flatLinks = () =>
  nav()
    .getAllByRole("link")
    .map((link) => [link.textContent, link.getAttribute("aria-current")]);

const menuItems = ({ menu }: { menu: string }) => {
  fireEvent.click(nav().getByRole("button", { name: menu }));
  const items = within(screen.getByRole("menu")).getAllByRole("menuitem");
  const labels = items.map((item) => item.textContent);
  fireEvent.click(nav().getByRole("button", { name: menu }));
  return labels;
};

describe("<HavenTopBar/>", () => {
  describe("given a stack's home on its own host", () => {
    const renderHome = () =>
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

    it("keeps Home, Hub, App and Logs flat", () => {
      renderHome();
      expect(flatLinks()).toEqual([
        ["Home", "page"],
        ["Hub", null],
        ["App", null],
        ["Logs", null],
      ]);
      expect(screen.getByRole("link", { name: "Logs" }).getAttribute("href")).toBe(
        "https://hub.langwatch.localhost/logs/feat-x",
      );
    });

    it("puts the answering simulators in Sims and the dev tools in Tools", () => {
      renderHome();
      expect(menuItems({ menu: "Sims" })).toEqual(["Mail", "IdP", "Storage", "LLM", "Analytics"]);
      expect(menuItems({ menu: "Tools" })).toEqual(["Grafana"]);
    });
  });

  describe("given the hub with one live stack", () => {
    it("links that stack's consoles beside Hub, Logs and Settings", () => {
      render(<HavenTopBar current="hub" hubHref="/" stacks={hub({ now: Date.now() }).stacks} />);
      expect(flatLinks().map(([label]) => label)).toEqual(
        expect.arrayContaining(["Settings", "App"]),
      );
      expect(menuItems({ menu: "Sims" })).toEqual(["IdP", "Mail", "Storage", "LLM", "Analytics"]);
    });
  });

  describe("given the hub with several live stacks", () => {
    it("names each stack's consoles for its slug, Grafana once", () => {
      const [first] = hub({ now: Date.now() }).stacks;
      if (first === undefined) throw new Error("the hub fixture has a stack");
      const second = {
        ...first,
        slug: "feat-y",
        surfaces: surfacesFor({ slug: "feat-y" }),
      };
      render(<HavenTopBar current="hub" hubHref="/" stacks={[first, second]} />);
      expect(menuItems({ menu: "App" })).toEqual(["feat-x", "feat-y"]);
      expect(menuItems({ menu: "Sims" })).toContain("feat-y · Mail");
      expect(menuItems({ menu: "Tools" })).toEqual(["Grafana"]);
    });
  });
});
