/**
 * @vitest-environment jsdom
 *
 * A save the seam refused for a newer version is not a failed save.
 *
 * The refusal happens before anything is written, so nothing is lost and the
 * remedy is one reload. Reporting it as "Failed to save" tells the reader their
 * work is gone. It reads worst exactly where it is most common: right after the
 * assistant saves a version of its own, over columns the reader watched it
 * build.
 *
 * @see specs/experiments-v3/workbench-versioning.feature
 *   ("The toolbar names the reason a save was refused")
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AutosaveStatus } from "../components/autosave-status";
import { AUTOSAVE_OUT_OF_DATE_REASON } from "../constants";

const renderStatus = (props: Parameters<typeof AutosaveStatus>[0]) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <AutosaveStatus {...props} />
    </ChakraProvider>,
  );

describe("given the workbench save status", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when a save was refused for a newer version", () => {
    /** @scenario "The toolbar names the reason a save was refused" */
    it("names the workbench out of date instead of failed", () => {
      renderStatus({
        evaluationState: "error",
        datasetState: "idle",
        evaluationError: AUTOSAVE_OUT_OF_DATE_REASON,
      });

      expect(screen.getByText(AUTOSAVE_OUT_OF_DATE_REASON)).toBeDefined();
      expect(screen.queryByText("Failed to save")).toBeNull();
    });
  });

  describe("when a save failed for any other reason", () => {
    /** @scenario "A save that truly failed is still reported as a failure" */
    it("reports the failure", () => {
      renderStatus({
        evaluationState: "error",
        datasetState: "idle",
        evaluationError: "Network request failed",
      });

      expect(screen.getByText("Failed to save")).toBeDefined();
    });
  });

  describe("when a refusal and a real failure arrive together", () => {
    it("reports the failure, which is the one that needs attention", () => {
      renderStatus({
        evaluationState: "error",
        datasetState: "error",
        evaluationError: AUTOSAVE_OUT_OF_DATE_REASON,
        datasetError: "Network request failed",
      });

      expect(screen.getByText("Failed to save")).toBeDefined();
      expect(screen.queryByText(AUTOSAVE_OUT_OF_DATE_REASON)).toBeNull();
    });
  });
});
