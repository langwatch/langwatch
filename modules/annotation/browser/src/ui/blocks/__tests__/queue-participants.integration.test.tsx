// @vitest-environment jsdom
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QueueParticipants } from "../queue-participants.tsx";

afterEach(cleanup);

describe("given no queue destinations", () => {
  it("disables the picker and offers creation outside its popup", async () => {
    const create = vi.fn();
    renderWithDesignSystem(
      <QueueParticipants
        annotators={[]}
        setAnnotators={() => void 0}
        queues={[]}
        members={[]}
        onCreateQueue={create}
        onSend={() => void 0}
        isSending={false}
      />,
    );
    const trigger = screen.getByRole("combobox");
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAccessibleDescription(/No participants or queues are available/);
    await userEvent.setup().click(screen.getByRole("button", { name: "Create a queue" }));
    expect(create).toHaveBeenCalledOnce();
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
