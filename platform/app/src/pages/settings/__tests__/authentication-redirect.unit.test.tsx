/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../components/WithPermissionGuard", () => ({
  withPermissionGuard:
    (
      _permission: string,
      {
        layoutComponent: Layout,
      }: {
        layoutComponent: ComponentType<{ children?: ReactNode }>;
      },
    ) =>
    (Page: ComponentType) =>
    () => (
      <Layout>
        <Page />
      </Layout>
    ),
}));

vi.mock("../../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org_acme", name: "Acme" },
  }),
}));

vi.mock("../../../components/SettingsLayout", () => ({
  default: ({ children }: { children?: ReactNode }) => (
    <div data-testid="settings-layout">{children}</div>
  ),
}));

vi.mock(
  "../../../components/settings/authentication/AuthenticationLayout",
  () => ({
    AuthenticationLayout: ({ children }: { children: ReactNode }) => (
      <div data-testid="authentication-layout">{children}</div>
    ),
  }),
);

vi.mock("../../../components/settings/AuthenticationSettings", () => ({
  AuthenticationSettings: ({ organizationId }: { organizationId: string }) => (
    <div data-testid="authentication-settings">{organizationId}</div>
  ),
}));

import AuthenticationPage from "../authentication";

describe("the Authentication settings address", () => {
  it("renders the organization's SSO overview inside settings chrome", () => {
    render(
      <ChakraProvider value={defaultSystem}>
        <MemoryRouter initialEntries={["/settings/authentication"]}>
          <AuthenticationPage />
        </MemoryRouter>
      </ChakraProvider>,
    );

    expect(screen.getByTestId("settings-layout")).toBeInTheDocument();
    expect(screen.getByTestId("authentication-layout")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Overview" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("authentication-settings")).toHaveTextContent(
      "org_acme",
    );
  });
});
