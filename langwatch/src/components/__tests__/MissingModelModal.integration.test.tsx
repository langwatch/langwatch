/**
 * @vitest-environment jsdom
 *
 * Integration tests for MissingModelModal — verifies the modal content,
 * the Configure CTA target, the inline "Customize" link, and the
 * read-only variant when the current user lacks
 * organization:manage / project:update.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MissingModelModal } from "../MissingModelModal";
import { useMissingModelModalStore } from "../../stores/missingModelModalStore";

const mockHasPermission = vi.fn();
vi.mock("../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1", slug: "acme-app" },
    organization: { id: "org-1", name: "Acme" },
    team: { id: "team-1", name: "Platform" },
    hasPermission: (p: string) => mockHasPermission(p),
  }),
}));

vi.mock("~/utils/compat/next-link", () => ({
  default: ({
    href,
    children,
    onClick,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: (e: React.MouseEvent) => void;
  }) => (
    <a href={href} onClick={onClick} {...rest}>
      {children}
    </a>
  ),
}));

function renderModal() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <MissingModelModal />
    </ChakraProvider>,
  );
}

describe("<MissingModelModal />", () => {
  beforeEach(() => {
    useMissingModelModalStore.getState().close();
    mockHasPermission.mockReset();
  });
  afterEach(() => {
    cleanup();
    useMissingModelModalStore.getState().close();
  });

  describe("when the user has permission to configure models", () => {
    beforeEach(() => {
      mockHasPermission.mockImplementation(
        (p: string) =>
          p === "organization:manage" || p === "project:update",
      );
    });

    /** @scenario The modal names the feature, the role, and the scope it couldn't resolve from */
    it("titles the modal with the feature display name and describes the gap", () => {
      useMissingModelModalStore.getState().open({
        featureKey: "traces.ai_search",
        featureDisplayName: "AI search",
        role: "FAST",
        projectId: "proj-1",
      });
      renderModal();

      expect(
        screen.getByText(/Model not configured for AI search/i),
      ).toBeInTheDocument();
      // Body mentions project, team, and organization in order so the
      // user knows where the gap is.
      const body = screen.getByTestId("missing-model-modal");
      expect(body.textContent).toMatch(/Fast/);
      expect(body.textContent).toMatch(/project/);
      expect(body.textContent).toMatch(/team/);
      expect(body.textContent).toMatch(/organization/);
    });

    /** @scenario The modal carries one primary CTA to the right settings page and role */
    it("shows a primary Configure CTA that deep-links to the role anchor", () => {
      useMissingModelModalStore.getState().open({
        featureKey: "traces.ai_search",
        featureDisplayName: "AI search",
        role: "FAST",
        projectId: "proj-1",
      });
      renderModal();

      const cta = screen.getByTestId(
        "missing-model-configure-cta",
      ) as HTMLAnchorElement;
      expect(cta).toBeInTheDocument();
      expect(cta.textContent).toMatch(/Configure Fast model/i);
      // Anchor target is the model-providers page scoped to the current
      // project, with the Fast role anchor so the page can scroll/focus.
      const href = cta.querySelector("a")?.getAttribute("href") ?? cta.getAttribute("href") ?? "";
      expect(href).toContain("/acme-app/settings/model-providers");
      expect(href).toContain("#role-fast");
    });

    /** @scenario An inline "Customize for this feature" link routes to the per-feature override */
    it("renders an inline link that targets the per-feature override anchor", () => {
      useMissingModelModalStore.getState().open({
        featureKey: "traces.ai_search",
        featureDisplayName: "AI search",
        role: "FAST",
        projectId: "proj-1",
      });
      renderModal();

      const link = screen.getByTestId(
        "missing-model-feature-link",
      ) as HTMLAnchorElement;
      expect(link.textContent).toMatch(/customize for AI search/i);
      const href = link.getAttribute("href") ?? "";
      expect(href).toContain("expand=fast");
      expect(href).toContain("feature=traces.ai_search");
    });
  });

  describe("when the user is read-only (no organization:manage and no project:update)", () => {
    beforeEach(() => {
      mockHasPermission.mockReturnValue(false);
    });

    /** @scenario A read-only user sees the modal but no Configure button */
    it("renders the explanation but omits the Configure CTA", () => {
      useMissingModelModalStore.getState().open({
        featureKey: "traces.ai_search",
        featureDisplayName: "AI search",
        role: "FAST",
        projectId: "proj-1",
      });
      renderModal();

      expect(
        screen.getByText(/Model not configured for AI search/i),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("missing-model-configure-cta"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(/Ask an organization or project admin/i),
      ).toBeInTheDocument();
    });
  });
});
