// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
// @vitest-environment jsdom
/**
 * The Advanced group in the composer's source-specific fields: options an
 * admin rarely needs stay collapsed and out of the way until asked for.
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 */
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { SourceType } from "../../../features/ingestion-sources/model/ingestion-source-catalog";
import { fakeGovernanceHost, renderWithGovernanceHost } from "../../../testing";
import { ParserConfigFields } from "../governance-inventory.screen";

afterEach(cleanup);

function Harness({ sourceType }: { sourceType: SourceType }) {
  const [values, setValues] = useState<Record<string, string>>({});
  return <ParserConfigFields sourceType={sourceType} values={values} onChange={setValues} />;
}

const renderFields = (sourceType: SourceType) =>
  renderWithGovernanceHost(<Harness sourceType={sourceType} />, {
    host: fakeGovernanceHost(),
  });

describe("given the Genie source-specific fields", () => {
  describe("when the form first renders", () => {
    /** @scenario "Genie setup asks for the service principal first" */
    it("shows workspace URL and the service principal pair, in that order", () => {
      renderFields("databricks_genie");
      const labels = screen
        .getAllByText(/Workspace URL|Service principal client ID|Service principal secret/)
        .map((el) => el.textContent);
      expect(labels.slice(0, 3)).toEqual([
        expect.stringContaining("Workspace URL"),
        expect.stringContaining("Service principal client ID"),
        expect.stringContaining("Service principal secret"),
      ]);
    });

    /** @scenario "Genie setup asks for the service principal first" */
    it("keeps the token, space IDs, and warehouse ID hidden until Advanced expands", async () => {
      renderFields("databricks_genie");
      expect(screen.queryByText("Workspace token")).toBeNull();
      expect(screen.queryByText(/Genie space IDs/)).toBeNull();
      expect(screen.queryByText(/SQL warehouse ID/)).toBeNull();

      const user = userEvent.setup();
      await user.click(screen.getByText("Advanced"));
      await waitFor(() => {
        expect(screen.getByText("Workspace token")).toBeTruthy();
      });
      expect(screen.getByText(/Genie space IDs/)).toBeTruthy();
      expect(screen.getByText(/SQL warehouse ID/)).toBeTruthy();
    });
  });

  describe("when a source type declares no Advanced fields", () => {
    it("renders no Advanced group at all", () => {
      renderFields("s3_custom");
      expect(screen.queryByText("Advanced")).toBeNull();
    });
  });
});
