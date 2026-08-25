/**
 * @vitest-environment jsdom
 *
 * The Tags field in the New virtual key drawer, rendered for real: the actual
 * drawer, the actual (i) popover, the actual Chakra tree. Only the data
 * boundaries (tRPC, the org/team/project hook) are stubbed.
 *
 * Typing a tag is the moment a person decides what will show up on every
 * trace the key produces, so these lock in that the explanation is reachable
 * at exactly that moment, and that a list which would not survive the save
 * says so first.
 *
 * Spec: specs/ai-gateway/virtual-keys.feature (Tags field).
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VK_TAG_MAX_LENGTH, VK_TAGS_MAX_COUNT } from "~/server/gateway/virtualKey.config";

import { VirtualKeyCreateDrawer } from "../VirtualKeyCreateDrawer";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1", name: "ACME", teams: [] },
    team: undefined,
    project: undefined,
    hasPermission: () => true,
  }),
}));

vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({
    data: { user: { id: "user-1", name: "Ada", email: "ada@acme.test" } },
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      virtualKeys: {
        list: { invalidate: vi.fn() },
        applicableBudgets: { invalidate: vi.fn() },
      },
    }),
    virtualKeys: {
      create: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      applicableBudgets: {
        useQuery: () => ({ data: [] }),
      },
    },
    modelProvider: {
      listAllForOrganizationForFrontend: {
        useQuery: () => ({ data: undefined, isLoading: false }),
      },
    },
    routingPolicy: {
      list: { useQuery: () => ({ data: [], isLoading: false }) },
    },
    user: {
      personalContext: {
        useQuery: () => ({ data: undefined }),
      },
    },
  },
}));

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const renderDrawer = () =>
  render(
    <VirtualKeyCreateDrawer
      organizationId="org-1"
      open={true}
      onOpenChange={vi.fn()}
      onCreated={vi.fn()}
    />,
    { wrapper: Wrapper },
  );

const tagsInput = () => screen.getByPlaceholderText("e.g. tier=enterprise, team=ml");

/** The field wrapper, so a query stays scoped to Tags and not a sibling. */
const tagsField = (): HTMLElement => {
  const field = tagsInput().closest(".chakra-field__root");
  if (!(field instanceof HTMLElement)) {
    throw new Error("the Tags input is not inside a field root");
  }
  return field;
};

const openTagsInfo = async () => {
  await userEvent.click(screen.getByTestId("vk-tags-info"));
};

describe("given the New virtual key drawer is open", () => {
  afterEach(() => cleanup());

  describe("when the Tags label's information icon is opened", () => {
    /** @scenario The Tags field explains itself behind the label's information icon */
    it("says what tags do for the person typing them", async () => {
      renderDrawer();

      await openTagsInfo();

      await waitFor(() =>
        expect(
          screen.getByText(/Group this key's traffic by team, app, or environment/),
        ).toBeVisible(),
      );
    });

    /** @scenario The Tags field explains itself behind the label's information icon */
    it("warns that the tags become labels everyone in the project can see", async () => {
      renderDrawer();

      await openTagsInfo();

      await waitFor(() =>
        expect(
          screen.getByText(
            /Every trace this key sends carries its tags as labels, so anyone with access to the project can see them and filter on them/,
          ),
        ).toBeVisible(),
      );
    });

    /** @scenario The Tags field explains itself behind the label's information icon */
    it("explains cache-rule matching without naming the internals", async () => {
      renderDrawer();

      await openTagsInfo();

      const explanation = screen.getByText(
        /A cache rule that lists tags applies to any key carrying all of them/,
      );
      await waitFor(() => expect(explanation).toBeVisible());
      expect(explanation.textContent).not.toMatch(/AND-subset|vk_tags|\bVKs?\b/);
    });

    /** @scenario The Tags field explains itself behind the label's information icon */
    it("states what saving does to a list that runs past the limits", async () => {
      renderDrawer();

      await openTagsInfo();

      await waitFor(() =>
        expect(
          screen.getByText(
            new RegExp(
              `Saving keeps the first ${VK_TAGS_MAX_COUNT} tags, trims each to ${VK_TAG_MAX_LENGTH} characters, and drops blanks and repeats`,
            ),
          ),
        ).toBeVisible(),
      );
    });

    /** @scenario The Tags field explains itself behind the label's information icon */
    it("links out to the cache-rules docs", async () => {
      renderDrawer();

      await openTagsInfo();

      const link = screen.getByRole("link", { name: /Read more/ });
      await waitFor(() => expect(link).toBeVisible());
      expect(link).toHaveAttribute(
        "href",
        "https://langwatch.ai/docs/ai-gateway/cache-control#cache-rules",
      );
    });
  });

  describe("when nothing has been typed into Tags", () => {
    /** @scenario The Tags field explains itself behind the label's information icon */
    it("leaves no explanation sitting under the field", () => {
      renderDrawer();

      expect(
        within(tagsField()).queryByText(/cache rule|labels|Comma-separated/i),
      ).not.toBeInTheDocument();
    });

    /** @scenario The Tags field explains itself behind the label's information icon */
    it("keeps the explanation behind the icon rather than on the page", () => {
      renderDrawer();

      expect(screen.getByText(/Group this key's traffic by team/)).not.toBeVisible();
    });
  });

  describe("when more tags are typed than the key keeps", () => {
    /** @scenario A tag list that will not survive the save says so before saving */
    it("warns that the extra ones will not be saved", async () => {
      renderDrawer();

      const tooMany = Array.from(
        { length: VK_TAGS_MAX_COUNT + 1 },
        (_, i) => `team=${i}`,
      ).join(",");
      await userEvent.click(tagsInput());
      await userEvent.paste(tooMany);

      expect(
        within(tagsField()).getByText(
          `Only the first ${VK_TAGS_MAX_COUNT} tags will be saved.`,
        ),
      ).toBeInTheDocument();
    });
  });

  describe("when a tag longer than the limit is typed", () => {
    /** @scenario A tag list that will not survive the save says so before saving */
    it("warns that it will be shortened", async () => {
      renderDrawer();

      await userEvent.click(tagsInput());
      await userEvent.paste(`team=${"x".repeat(VK_TAG_MAX_LENGTH)}`);

      expect(
        within(tagsField()).getByText(
          `Tags longer than ${VK_TAG_MAX_LENGTH} characters will be shortened.`,
        ),
      ).toBeInTheDocument();
    });
  });

  describe("when an ordinary tag list is typed", () => {
    /** @scenario A tag list within the limits gets no warning */
    it("shows no warning under the field", async () => {
      renderDrawer();

      await userEvent.click(tagsInput());
      await userEvent.paste("tier=enterprise, team=ml");

      expect(
        within(tagsField()).queryByText(/will be saved|will be shortened/),
      ).not.toBeInTheDocument();
    });
  });
});
