/**
 * @vitest-environment jsdom
 *
 * The run dialog's footer offers a second action, "Call it myself", beside Run
 * only when the target is a voice agent, and shows the lone Run action for
 * every other target (AC23, AC25).
 *
 * @see specs/features/agents/voice-agents-v1.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "~/components/ui/dialog";
import { RunDialogFooter } from "../run-dialog-footer.tsx";
import type { RunDialogController } from "../use-run-dialog-submit.ts";

afterEach(cleanup);

const controller: RunDialogController = {
  run: vi.fn(),
  isBusy: false,
  hasAnyTarget: true,
};

function renderFooter(over: { onCallItMyself?: () => void } = {}) {
  const ui: ReactNode = (
    <ChakraProvider value={defaultSystem}>
      <Dialog.Root open onOpenChange={() => {}}>
        <Dialog.Content>
          <RunDialogFooter
            controller={controller}
            isRunBlocked={false}
            blockedReason={null}
            caseCount={1}
            targetCount={1}
            onClose={vi.fn()}
            {...over}
          />
        </Dialog.Content>
      </Dialog.Root>
    </ChakraProvider>
  );
  return render(ui);
}

describe("RunDialog footer", () => {
  describe("when the target is a voice agent", () => {
    /** @scenario "Call it myself against a scenario and be scored on its criteria" */
    it("shows both Run and Call it myself", () => {
      renderFooter({ onCallItMyself: vi.fn() });
      expect(screen.getByTestId("run-dialog-run")).toBeInTheDocument();
      expect(
        screen.getByTestId("run-dialog-call-it-myself"),
      ).toBeInTheDocument();
    });
  });

  describe("when the target is not a voice agent", () => {
    /** @scenario "Existing HTTP, Code and Workflow agent flows are unchanged" */
    it("shows Run alone and no Call it myself", () => {
      renderFooter();
      expect(screen.getByTestId("run-dialog-run")).toBeInTheDocument();
      expect(
        screen.queryByTestId("run-dialog-call-it-myself"),
      ).not.toBeInTheDocument();
    });
  });
});
