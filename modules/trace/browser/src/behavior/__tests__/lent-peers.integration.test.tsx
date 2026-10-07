// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { AnnotateBodyToken, type AnnotateBodyProps } from "@langwatch/annotation-client";
import type { AnnotationFormState } from "@langwatch/annotation-contract";
import { uiDeclarations, type UiDeclarations } from "@langwatch/browser-host/declarations";
import { MediaPartToken } from "@langwatch/scenario-client";
import type { MediaPartProps } from "@langwatch/scenario-contract";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const declarations: { current: UiDeclarations | undefined } = vi.hoisted(() => ({
  current: undefined,
}));

vi.mock("@langwatch/browser-host/capabilities", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useUiDeclarations: () => declarations.current,
}));

import { AnnotateBody } from "../lent-annotation-form.tsx";
import { LentMediaPart } from "../lent-media-part.tsx";

const peerLends = uiDeclarations([
  {
    name: "scenario",
    installation: {
      capabilities: {},
      lends: [
        {
          token: MediaPartToken,
          load: async () => ({
            default: ({ part, projectId }: MediaPartProps) => (
              <span>
                {part.type} media in {projectId}
              </span>
            ),
          }),
        },
      ],
    },
  },
  {
    name: "annotation",
    installation: {
      capabilities: {},
      lends: [
        {
          token: AnnotateBodyToken,
          load: async () => ({
            default: ({ state }: AnnotateBodyProps) => <textarea defaultValue={state.comment} />,
          }),
        },
      ],
    },
  },
]);

const imagePart: MediaPartProps["part"] = {
  type: "image",
  source: { type: "url", value: "https://example.com/cat.png" },
};

const formState: AnnotationFormState = {
  comment: "looks right",
  setComment: () => undefined,
  expectedOutput: "",
  setExpectedOutput: () => undefined,
  scoreOptions: {},
  setScoreOptions: () => undefined,
  scores: { data: undefined, isLoading: false },
  isEdit: false,
  isSaving: false,
  isDeleting: false,
  hasExisting: false,
  isSaveBlocked: false,
  anchorLabel: null,
  suggestTarget: "output",
  handleSave: () => undefined,
  handleDelete: () => undefined,
  onCancel: () => undefined,
  mode: "annotate",
};

afterEach(() => {
  cleanup();
  declarations.current = undefined;
});

describe("what scenario and annotation lend trace", () => {
  describe("given scenario lends its media renderer", () => {
    /** @scenario Trace draws scenario's media part through scenario's client token */
    it("draws the part with the project it is handed", async () => {
      declarations.current = peerLends;
      render(<LentMediaPart part={imagePart} projectId="project_1" />);
      expect(await screen.findByText("image media in project_1")).toBeInTheDocument();
    });
  });

  describe("given annotation lends its form body", () => {
    /** @scenario Trace draws annotation's form body through annotation's client token */
    it("draws the body over the form state it is handed", async () => {
      declarations.current = peerLends;
      render(<AnnotateBody state={formState} />);
      expect(await screen.findByDisplayValue("looks right")).toBeInTheDocument();
    });
  });

  describe("given neither is installed", () => {
    /** @scenario Trace draws scenario's media part through scenario's client token */
    it("draws no media part", () => {
      declarations.current = uiDeclarations([]);
      const { container } = render(<LentMediaPart part={imagePart} projectId="project_1" />);
      expect(container).toBeEmptyDOMElement();
    });

    /** @scenario Trace draws annotation's form body through annotation's client token */
    it("draws no form body", () => {
      declarations.current = uiDeclarations([]);
      const { container } = render(<AnnotateBody state={formState} />);
      expect(container).toBeEmptyDOMElement();
    });
  });
});
