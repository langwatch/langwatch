/**
 * @vitest-environment jsdom
 *
 * The `langwatch.api_key.id` metadata row in the trace drawer: label trimmed to
 * `langwatch.api_key`, value resolved from the ApiKey row id to the key's name
 * and linked to that key on the settings page. The name is resolved one id at
 * a time so an ordinary member sees it, not only key administrators.
 *
 * Spec: specs/traces-v2/api-key-attribute.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj-1" },
    organization: { id: "org-1" },
  }),
}));

vi.mock("../../../../elements/next-link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const mockNameById = vi.fn();

vi.mock("../../../trace-api", () => ({
  api: {
    apiKey: { nameById: { useQuery: () => mockNameById() } },
  },
}));

import { AttributeTable } from "../attribute-table";

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
      mockNameById.mockReturnValue({
        data: { name: "CI Pipeline", revoked: false },
      });
      renderWithApiKeyAttribute();

      expect(screen.getByText("langwatch.api_key")).toBeInTheDocument();
      expect(screen.queryByText("langwatch.api_key.id")).not.toBeInTheDocument();
    });

    /** @scenario The value resolves to the key's name and links to it */
    it("shows the key name as a link to that key on the settings page", () => {
      mockNameById.mockReturnValue({
        data: { name: "CI Pipeline", revoked: false },
      });
      renderWithApiKeyAttribute();

      const link = screen.getByRole("link", { name: "CI Pipeline" });
      expect(link).toHaveAttribute("href", "/settings/api-keys#api-key-key_abc123");
      // The raw id is not what the operator reads, only what they copy.
      expect(screen.queryByText("key_abc123")).not.toBeInTheDocument();
    });
  });

  describe("given the key that ingested the trace has been revoked", () => {
    /** @scenario A revoked key still shows its name */
    it("still shows the name rather than the raw id", () => {
      mockNameById.mockReturnValue({
        data: { name: "Retired ingestion key", revoked: true },
      });
      renderWithApiKeyAttribute();

      expect(screen.getByText("Retired ingestion key")).toBeInTheDocument();
      expect(screen.queryByText("key_abc123")).not.toBeInTheDocument();
    });
  });

  describe("given the key is deleted, foreign, or the view is publicly shared", () => {
    /** @scenario An unresolvable key falls back to the raw id */
    it("falls back to the raw id with no link", () => {
      mockNameById.mockReturnValue({ data: null });
      renderWithApiKeyAttribute();

      expect(screen.getByText("key_abc123")).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    /** @scenario An unresolvable key falls back to the raw id */
    it("falls back to the raw id while the name is still loading", () => {
      mockNameById.mockReturnValue({ data: undefined });
      renderWithApiKeyAttribute();

      expect(screen.getByText("key_abc123")).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });
  });
});
