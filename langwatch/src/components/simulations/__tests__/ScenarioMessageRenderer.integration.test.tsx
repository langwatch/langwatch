/**
 * @vitest-environment jsdom
 *
 * Integration test for ScenarioMessageRenderer's content coercion.
 *
 * Pins the renderer/extractor coercion parity: when the python-sdk sends
 * `content` as a Python `repr(list)` string (single quotes, None/True/False
 * keywords), the renderer must walk it the same way the stored-objects
 * extractor does instead of dumping the raw repr blob into the bubble.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ScenarioMessageRenderer } from "../ScenarioMessageRenderer";
import type { ScenarioMessageSnapshotEvent } from "~/server/scenarios/scenario-event.types";

vi.mock("~/utils/api", () => ({
  api: {
    storedObjects: {
      headById: {
        useQuery: () => ({ data: undefined }),
      },
    },
  },
}));

vi.mock("../../copilot-kit/TraceMessage", () => ({
  TraceMessage: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const PROJECT_ID = "proj_test";

const renderWith = (
  messages: ScenarioMessageSnapshotEvent["messages"],
): void => {
  render(
    <Wrapper>
      <ScenarioMessageRenderer
        messages={messages}
        variant="drawer"
        projectId={PROJECT_ID}
      />
    </Wrapper>,
  );
};

describe("<ScenarioMessageRenderer/>", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => cleanup());

  describe("when a message arrives with content as a python-repr string", () => {
    it("renders an <audio> element instead of the raw repr blob", () => {
      const pythonReprContent =
        "[{'type': 'input_audio', 'input_audio': {'data': 'UklGRg==', 'format': 'wav'}}]";

      renderWith([
        {
          id: "msg_audio_repr",
          role: "user",
          content: pythonReprContent,
        } as ScenarioMessageSnapshotEvent["messages"][number],
      ]);

      const audio = document.querySelector("audio");
      expect(audio).not.toBeNull();
      expect(screen.queryByText(/input_audio/)).toBeNull();
    });
  });

  describe("when a message arrives with content as a JSON-encoded array string", () => {
    it("renders the same way as the python-repr equivalent", () => {
      const jsonContent =
        '[{"type":"input_audio","input_audio":{"data":"UklGRg==","format":"wav"}}]';

      renderWith([
        {
          id: "msg_audio_json",
          role: "user",
          content: jsonContent,
        } as ScenarioMessageSnapshotEvent["messages"][number],
      ]);

      const audio = document.querySelector("audio");
      expect(audio).not.toBeNull();
    });
  });

  describe("when a message arrives with a sibling text part as a transcript", () => {
    it("renders audio + italic transcript and not the raw blob", () => {
      const pythonReprContent =
        "[{'type': 'input_audio', 'input_audio': {'data': 'UklGRg==', 'format': 'wav'}}, {'type': 'text', 'text': 'hello world'}]";

      renderWith([
        {
          id: "msg_audio_with_transcript",
          role: "assistant",
          content: pythonReprContent,
        } as ScenarioMessageSnapshotEvent["messages"][number],
      ]);

      expect(document.querySelector("audio")).not.toBeNull();
      expect(screen.getByText("hello world")).toBeInTheDocument();
    });
  });

  describe("when a message has plain string content (not array-shaped)", () => {
    it("renders as a text bubble unchanged", () => {
      renderWith([
        {
          id: "msg_plain",
          role: "assistant",
          content: "hello there",
        } as ScenarioMessageSnapshotEvent["messages"][number],
      ]);

      expect(screen.getByText("hello there")).toBeInTheDocument();
      expect(document.querySelector("audio")).toBeNull();
    });
  });
});
