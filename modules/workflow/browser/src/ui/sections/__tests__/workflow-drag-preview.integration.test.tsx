/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { afterEach, describe, expect, it } from "vitest";

import { WorkflowDragPreview } from "../workflow-drag-preview.tsx";

afterEach(cleanup);

describe("WorkflowDragPreview", () => {
  describe("when nothing is being dragged", () => {
    /** @scenario "The Studio canvas opens while nothing is being dragged" */
    it("renders nothing instead of reading the absent drag item", () => {
      const { container } = render(
        <DndProvider backend={HTML5Backend}>
          <WorkflowDragPreview />
        </DndProvider>,
      );

      expect(container.innerHTML).toBe("");
    });
  });
});
