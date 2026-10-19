import { chakra, Tag, Wrap } from "@langwatch/design-system/primitives";
import type { KeyboardEvent, Ref } from "react";

import {
  inviteEmailChips,
  inviteEmailsRaw,
  isInviteEmail,
  splitInviteEmails,
} from "../../model/add-members-form-model.ts";

/**
 * The invite's email box as removable chips: typing a separator, pasting a list or leaving
 * the box turns each address into a chip, and an address that is not one is flagged red.
 * It reads and writes the one raw string the form validates and submits.
 */
export function InviteEmailChips({
  value,
  onChange,
  onBlur,
  inputRef,
  invalid,
}: {
  value: string;
  onChange: (raw: string) => void;
  onBlur: () => void;
  inputRef: Ref<HTMLInputElement>;
  invalid: boolean;
}) {
  const { chips, draft } = inviteEmailChips(value);
  const write = ({ nextChips = chips, nextDraft = draft }) =>
    onChange(inviteEmailsRaw({ chips: nextChips, draft: nextDraft }));

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && draft !== "") {
      event.preventDefault();
      write({ nextChips: [...chips, draft], nextDraft: "" });
    } else if (event.key === "Backspace" && draft === "" && chips.length > 0) {
      write({ nextChips: chips.slice(0, -1) });
    }
  };

  return (
    <Wrap
      gap={1.5}
      align="center"
      minHeight="10"
      width="full"
      paddingX={2}
      paddingY={1.5}
      borderWidth="1px"
      borderRadius="l2"
      borderColor={invalid ? "border.error" : "border"}
      background="bg.panel"
      cursor="text"
      _focusWithin={{ outline: "2px solid", outlineColor: "colorPalette.focusRing" }}
      colorPalette="orange"
    >
      {chips.map((email, index) => {
        const valid = isInviteEmail(email);
        return (
          <Tag.Root
            key={`${email}-${index}`}
            size="lg"
            variant={valid ? "subtle" : "outline"}
            colorPalette={valid ? "gray" : "red"}
            title={valid ? undefined : "Not a valid email address"}
            data-invalid={valid ? undefined : ""}
          >
            <Tag.Label>{email}</Tag.Label>
            <Tag.EndElement>
              <Tag.CloseTrigger
                aria-label={`Remove ${email}`}
                onClick={() => write({ nextChips: chips.filter((_, i) => i !== index) })}
              />
            </Tag.EndElement>
          </Tag.Root>
        );
      })}
      <chakra.input
        ref={inputRef}
        flex="1"
        minWidth="160px"
        height="7"
        background="transparent"
        outline="none"
        fontSize="sm"
        placeholder={chips.length === 0 ? "alice@example.com, bob@example.com" : undefined}
        aria-label="Email addresses"
        data-testid="members-invite-emails"
        value={draft}
        onChange={(event) => write({ nextDraft: event.target.value })}
        onKeyDown={onKeyDown}
        onPaste={(event) => {
          const pasted = splitInviteEmails(`${draft} ${event.clipboardData.getData("text")}`);
          if (pasted.length === 0) return;
          event.preventDefault();
          write({ nextChips: [...chips, ...pasted], nextDraft: "" });
        }}
        onBlur={() => {
          if (draft !== "") write({ nextChips: [...chips, draft], nextDraft: "" });
          onBlur();
        }}
      />
    </Wrap>
  );
}
