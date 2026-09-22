/**
 * @vitest-environment jsdom
 *
 * The whole-call audio player: shown for a voice run, streaming the run's own
 * recording, and offering a Retry when the recording is not ready yet.
 *
 * @see specs/features/agents/voice-phone.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { shouldShowWholeCallAudio, WholeCallAudio } from "../WholeCallAudio";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

afterEach(cleanup);

describe("shouldShowWholeCallAudio", () => {
  describe("when the run targeted a voice agent and carries its ids", () => {
    it("shows the player", () => {
      expect(
        shouldShowWholeCallAudio({
          langwatch: { targetType: "voice" },
          scenarioRunId: "run_1",
          projectId: "project_1",
        }),
      ).toBe(true);
    });
  });

  describe("when the run targeted a non-voice agent", () => {
    it("does not show the player", () => {
      expect(
        shouldShowWholeCallAudio({
          langwatch: { targetType: "http" },
          scenarioRunId: "run_1",
          projectId: "project_1",
        }),
      ).toBe(false);
    });
  });

  describe("when the ids are not there yet", () => {
    it("does not show the player", () => {
      expect(
        shouldShowWholeCallAudio({
          langwatch: { targetType: "voice" },
          scenarioRunId: undefined,
          projectId: "project_1",
        }),
      ).toBe(false);
    });
  });
});

describe("WholeCallAudio", () => {
  describe("when the run has a recording to play", () => {
    it("renders an audio element pointed at the run-audio route", () => {
      render(
        <Wrapper>
          <WholeCallAudio scenarioRunId="run_1" projectId="project_1" />
        </Wrapper>,
      );

      const audio = screen.getByTestId("run-call-audio");
      expect(audio.getAttribute("src")).toContain("/api/voice/run/run_1/audio");
      expect(audio.getAttribute("src")).toContain("projectId=project_1");
      expect(audio.getAttribute("preload")).toBe("none");
    });
  });

  describe("when the recording is not ready yet", () => {
    it("shows a not-ready notice and a Retry that re-requests the recording", () => {
      render(
        <Wrapper>
          <WholeCallAudio scenarioRunId="run_1" projectId="project_1" />
        </Wrapper>,
      );

      const firstSrc = screen.getByTestId("run-call-audio").getAttribute("src");
      fireEvent.error(screen.getByTestId("run-call-audio"));

      expect(screen.getByTestId("run-call-audio-unavailable")).toBeTruthy();

      fireEvent.click(screen.getByTestId("run-call-audio-retry"));

      const retriedSrc = screen
        .getByTestId("run-call-audio")
        .getAttribute("src");
      expect(retriedSrc).toContain("/api/voice/run/run_1/audio");
      expect(retriedSrc).not.toBe(firstSrc);
    });
  });
});
