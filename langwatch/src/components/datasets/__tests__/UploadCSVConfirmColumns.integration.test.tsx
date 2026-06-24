/**
 * @vitest-environment jsdom
 *
 * ADR-032 v19 — the column-confirm seam. On the direct path the form parses the
 * file's header (bounded slice), hands the columns to the host's confirm step
 * via `requestColumnConfirm`, and only uploads once the host calls back
 * `onConfirmed` with the final names + types — which flow into
 * `requestDirectUpload` so the normalize job honours them.
 *
 * Boundaries mocked: the directUpload service, the header parser (for
 * deterministic columns), and the project/router/drawer/api hooks.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const requestDirectUpload = vi.fn();
const putFileToPresignedUrl = vi.fn();
const finalizeDirectUpload = vi.fn();
vi.mock("../services/directUpload", async (importActual) => {
  const actual =
    await importActual<typeof import("../services/directUpload")>();
  return {
    ...actual,
    requestDirectUpload: (...args: unknown[]) => requestDirectUpload(...args),
    putFileToPresignedUrl: (...args: unknown[]) =>
      putFileToPresignedUrl(...args),
    finalizeDirectUpload: (...args: unknown[]) => finalizeDirectUpload(...args),
    abortPendingUpload: vi.fn(),
  };
});

// Deterministic header parse: always two string columns, no slice/timing.
vi.mock("../utils/parseHeaderColumns", () => ({
  HEADER_PARSE_MAX_BYTES: 262144,
  parseHeaderColumns: vi.fn(async () => [
    { name: "score", type: "string" },
    { name: "name", type: "string" },
  ]),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "proj" },
  }),
}));
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ closeDrawer: vi.fn() }),
}));
vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      dataset: {
        findNextName: { fetch: vi.fn().mockResolvedValue("My DS") },
      },
    }),
  },
}));

import { UploadCSVForm } from "../UploadCSVDrawer";

beforeEach(() => {
  requestDirectUpload.mockReset();
  putFileToPresignedUrl.mockReset();
  finalizeDirectUpload.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("UploadCSVForm column-confirm seam", () => {
  describe("when a host provides requestColumnConfirm and the user picks a file", () => {
    it("confirms columns first, then uploads with the confirmed names + types", async () => {
      requestDirectUpload.mockResolvedValue({
        datasetId: "dataset_1",
        slug: "s",
        uploadUrl: "https://s3.example/put",
      });
      putFileToPresignedUrl.mockResolvedValue(undefined);
      finalizeDirectUpload.mockResolvedValue({
        datasetId: "dataset_1",
        status: "processing",
      });
      const requestColumnConfirm = vi.fn();
      const onDirectUploadComplete = vi.fn();
      const user = userEvent.setup();

      render(
        <ChakraProvider value={defaultSystem}>
          <UploadCSVForm
            setUploadedDataset={vi.fn()}
            uploadedDataset={undefined}
            uploadCSVData={vi.fn()}
            enableDirectUpload={true}
            requestColumnConfirm={requestColumnConfirm}
            onDirectUploadComplete={onDirectUploadComplete}
          />
        </ChakraProvider>,
      );

      const file = new File(["score,name\n1,a\n"], "data.csv", {
        type: "text/csv",
      });
      const input = document.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      await user.upload(input, file);
      // Flush the header-parse IIFE so parsedColumns is set before the click.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      await user.click(screen.getByRole("button", { name: /upload/i }));

      // The host's confirm step is invoked with the parsed columns — NOT a direct
      // upload yet.
      await waitFor(() =>
        expect(requestColumnConfirm).toHaveBeenCalledTimes(1),
      );
      expect(requestDirectUpload).not.toHaveBeenCalled();
      const confirmArg = requestColumnConfirm.mock.calls[0]![0];
      expect(confirmArg.columns).toEqual([
        { name: "score", type: "string" },
        { name: "name", type: "string" },
      ]);

      // The host confirms with a changed type (score → number) and an edited name.
      await act(async () => {
        confirmArg.onConfirmed({
          name: "My Renamed DS",
          columnTypes: [
            { name: "score", type: "number" },
            { name: "name", type: "string" },
          ],
        });
      });

      // Only now does the upload run — carrying the confirmed schema.
      await waitFor(() => expect(requestDirectUpload).toHaveBeenCalledTimes(1));
      expect(requestDirectUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "My Renamed DS",
          columnTypes: [
            { name: "score", type: "number" },
            { name: "name", type: "string" },
          ],
        }),
      );
      await waitFor(() =>
        expect(onDirectUploadComplete).toHaveBeenCalledWith("dataset_1"),
      );
    });
  });
});
