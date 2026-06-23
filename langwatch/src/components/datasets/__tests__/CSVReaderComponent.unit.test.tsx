/**
 * @vitest-environment jsdom
 *
 * Regression guard for ADR-032 D4 (the real OOM bug): on the direct-upload
 * path the dropzone must capture the raw `File` WITHOUT running PapaParse —
 * `react-papaparse`'s `CSVReader` parses the entire file in-browser before its
 * `onUploadAccepted` fires, which OOMs the tab on a multi-GB file. These tests
 * pin that `parse={false}` never touches `useCSVReader`/PapaParse and emits the
 * raw file, while `parse` (default) keeps the parse-and-emit behaviour that
 * `AddRowsFromCSVModal` and the no-storage fallback rely on.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

// Spy on the PapaParse surface so we can assert it is NOT invoked on the
// no-parse path. `useCSVReader` returns a passthrough `CSVReader` that just
// renders its children (so the parse-path render still works) but records that
// it was used.
const useCSVReader = vi.fn(() => ({
  CSVReader: ({ children }: { children: (fn: unknown) => React.ReactNode }) =>
    children({
      getRootProps: () => ({}),
      acceptedFile: null,
      ProgressBar: () => null,
      getRemoveFileProps: () => ({}),
      Remove: () => null,
    }),
}));
const readString = vi.fn();
vi.mock("react-papaparse", async (importActual) => {
  const actual = await importActual<typeof import("react-papaparse")>();
  return {
    ...actual,
    useCSVReader: () => useCSVReader(),
    usePapaParse: () => ({ readString }),
  };
});

import { CSVReaderComponent } from "../UploadCSVDrawer";

function renderReader(props: {
  parse?: boolean;
  onUploadAccepted?: (results: {
    data: string[][];
    acceptedFile: File;
  }) => void;
  onRawFile?: (file: File | null) => void;
  onUploadRemoved?: () => void;
}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <CSVReaderComponent
        onUploadAccepted={props.onUploadAccepted ?? vi.fn()}
        {...props}
      />
    </ChakraProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CSVReaderComponent", () => {
  describe("when parse is false (direct-upload path)", () => {
    it("emits the raw file without invoking PapaParse", async () => {
      const onRawFile = vi.fn();
      const onUploadAccepted = vi.fn();
      renderReader({ parse: false, onRawFile, onUploadAccepted });

      const input = document.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      const file = new File(["a,b\n1,2\n"], "big.csv", { type: "text/csv" });
      await userEvent.upload(input, file);

      // The raw file is captured...
      expect(onRawFile).toHaveBeenCalledTimes(1);
      expect(onRawFile.mock.calls[0]![0]).toBe(file);
      // ...and nothing parses it in-browser.
      expect(useCSVReader).not.toHaveBeenCalled();
      expect(readString).not.toHaveBeenCalled();
      expect(onUploadAccepted).not.toHaveBeenCalled();
    });

    it("emits null when the captured file is removed", async () => {
      const onRawFile = vi.fn();
      const onUploadRemoved = vi.fn();
      renderReader({ parse: false, onRawFile, onUploadRemoved });

      const input = document.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;
      await userEvent.upload(
        input,
        new File(["x"], "f.csv", { type: "text/csv" }),
      );
      onRawFile.mockClear();

      await userEvent.click(
        screen.getByRole("button", { name: /remove file/i }),
      );

      expect(onRawFile).toHaveBeenCalledWith(null);
      expect(onUploadRemoved).toHaveBeenCalledTimes(1);
    });
  });

  describe("when parse is true (default / fallback / AddRows path)", () => {
    it("uses the PapaParse-backed CSVReader", () => {
      renderReader({ parse: true });

      // The parse path goes through react-papaparse's CSVReader.
      expect(useCSVReader).toHaveBeenCalled();
      // No bare file input is rendered on the parse path.
      expect(document.querySelector('input[type="file"]')).toBeNull();
    });
  });
});
