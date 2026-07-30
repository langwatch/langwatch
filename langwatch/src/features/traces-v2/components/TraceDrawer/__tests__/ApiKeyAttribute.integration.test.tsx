/**
 * @vitest-environment jsdom
 *
 * The `langwatch.api_key.id` metadata row in the trace drawer: label trimmed to
 * `langwatch.api_key`, value resolved from the ApiKey row id to the key's name
 * and linked to that key on the settings page.
 *
 * Spec: specs/traces-v2/api-key-attribute.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1" },
    organization: { id: "org-1" },
  }),
}));

vi.mock("~/utils/compat/next-link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

const mockApiKeyList = vi.fn();

vi.mock("~/utils/api", () => ({
  api: {
    apiKey: { list: { useQuery: () => mockApiKeyList() } },
  },
}));

import { AttributeTable } from "../AttributeTable";

function renderWithApiKeyAttribute() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <AttributeTable
        attributes={{ "langwatch.api_key.id": "key_abc123" }}
        title="Trace Attributes"
      />
    </ChakraProvider>,
  );
}

describe("langwatch.api_key.id attribute row", () => {
  afterEach(cleanup);

  describe("given the viewer can list the key that ingested the trace", () => {
    /** @scenario The attribute label drops the trailing id segment */
    it("labels the row 'langwatch.api_key'", () => {
      mockApiKeyList.mockReturnValue({
        data: [{ id: "key_abc123", name: "CI Pipeline" }],
      });
      renderWithApiKeyAttribute();

      expect(screen.getByText("langwatch.api_key")).toBeInTheDocument();
      expect(
        screen.queryByText("langwatch.api_key.id"),
      ).not.toBeInTheDocument();
    });

    /** @scenario The value resolves to the key's name and links to it */
    it("shows the key name as a link to that key on the settings page", () => {
      mockApiKeyList.mockReturnValue({
        data: [{ id: "key_abc123", name: "CI Pipeline" }],
      });
      renderWithApiKeyAttribute();

      const link = screen.getByRole("link", { name: "CI Pipeline" });
      expect(link).toHaveAttribute(
        "href",
        "/settings/api-keys#api-key-key_abc123",
      );
      // The raw id is not what the operator reads, only what they copy.
      expect(screen.queryByText("key_abc123")).not.toBeInTheDocument();
    });
  });

  describe("given the key is revoked, deleted, or not listable by the viewer", () => {
    /** @scenario An unresolvable key falls back to the raw id */
    it("falls back to the raw id with no link", () => {
      mockApiKeyList.mockReturnValue({ data: [] });
      renderWithApiKeyAttribute();

      expect(screen.getByText("key_abc123")).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    /** @scenario An unresolvable key falls back to the raw id */
    it("falls back to the raw id while the key list is still loading", () => {
      mockApiKeyList.mockReturnValue({ data: undefined });
      renderWithApiKeyAttribute();

      expect(screen.getByText("key_abc123")).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });
  });
});
