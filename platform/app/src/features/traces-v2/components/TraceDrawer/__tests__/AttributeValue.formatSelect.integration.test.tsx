/**
 * @vitest-environment jsdom
 *
 * An attribute value offers the same compact format selector the rest of the
 * drawer uses, and a value detected as a JSON string reads as JSON in it
 * rather than falling through to the first option.
 *
 * UX contract: specs/traces-v2/io-toolbar.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { AttributeValue } from "../AttributeValue";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

afterEach(cleanup);

const openValue = async (user: ReturnType<typeof userEvent.setup>) => {
  const trigger = screen.getByRole("button");
  await user.click(trigger);
};

describe("given an attribute holding a chat-shaped value", () => {
  const chat = [
    { role: "user", content: "where is my order?" },
    { role: "assistant", content: "on its way" },
  ];

  /** @scenario "Conversation and attribute views use the same format selector" */
  it("offers chat, JSON and text through the format selector", async () => {
    const user = userEvent.setup();
    render(<AttributeValue attrKey="gen_ai.input.messages" value={chat} />, {
      wrapper,
    });

    await openValue(user);

    const select = await screen.findByRole("button", {
      name: "Attribute value format",
    });
    expect(select).toHaveTextContent("Chat");

    await user.click(select);
    expect(
      (await screen.findAllByRole("menuitem")).map((i) => i.textContent),
    ).toEqual(["Chat", "JSON", "Text"]);
  });

  it("switches the rendering when another format is picked", async () => {
    const user = userEvent.setup();
    render(<AttributeValue attrKey="gen_ai.input.messages" value={chat} />, {
      wrapper,
    });

    await openValue(user);
    await user.click(
      await screen.findByRole("button", { name: "Attribute value format" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Text" }));

    expect(
      screen.getByRole("button", { name: "Attribute value format" }),
    ).toHaveTextContent("Text");
  });
});

describe("given an attribute whose value is JSON inside a string", () => {
  /** @scenario "Conversation and attribute views use the same format selector" */
  it("reads as JSON in the selector rather than as the first option", async () => {
    const user = userEvent.setup();
    render(
      <AttributeValue
        attrKey="langwatch.reserved.value_types"
        value={'["langwatch.input=chat_messages","langwatch.output=text"]'}
      />,
      { wrapper },
    );

    await openValue(user);

    expect(
      await screen.findByRole("button", { name: "Attribute value format" }),
    ).toHaveTextContent("JSON");
  });
});
