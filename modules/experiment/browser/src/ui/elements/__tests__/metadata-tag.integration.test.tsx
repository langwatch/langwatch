// @vitest-environment jsdom
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const scope = vi.hoisted(() => ({ userLinkTemplate: null as string | null }));

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "p1", slug: "p1", name: "P1", userLinkTemplate: scope.userLinkTemplate },
  }),
}));
vi.mock("@langwatch/browser-host/link", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const { MetadataTag } = await import("../metadata-tag.tsx");

const renderTag = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <MetadataTag label="user_id" value="user-42" />
    </ChakraProvider>,
  );

describe("MetadataTag", () => {
  afterEach(cleanup);

  describe("given a project with a user link template", () => {
    it("links the user id through the template", () => {
      scope.userLinkTemplate = "https://crm.example/users/{{user_id}}";
      renderTag();

      expect(screen.getByRole("link")).toHaveAttribute("href", "https://crm.example/users/user-42");
    });
  });

  describe("given a project without one", () => {
    it("shows the plain user id", () => {
      scope.userLinkTemplate = null;
      renderTag();

      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.getByText("user-42")).toBeInTheDocument();
    });
  });
});
