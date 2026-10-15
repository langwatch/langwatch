/**
 * The ask bar as a field, at the top of "Add a widget": the bar the member clicked on the
 * board, now holding their text. What they type narrows the widgets; the pill asks Langy.
 */

import { chakra } from "@langwatch/design-system/primitives";
import type { Ref } from "react";

import {
  ASK_BAR_PROMPT,
  ASK_BAR_PROMPT_COLOR,
  ASK_BAR_WORDS,
  AskBarShell,
  AskPill,
} from "../elements/ask-bar-shell.tsx";

export function AskField({
  value,
  inputRef,
  onChange,
  onEnter,
  onAsk,
}: {
  value: string;
  inputRef?: Ref<HTMLInputElement>;
  onChange: (next: string) => void;
  onEnter?: () => void;
  /** Puts the typed text to Langy; absent when Langy is not available, and so is the pill. */
  onAsk?: () => void;
}) {
  return (
    <AskBarShell>
      <chakra.input
        ref={inputRef}
        type="search"
        aria-label={ASK_BAR_PROMPT}
        placeholder={ASK_BAR_PROMPT}
        height="full"
        background="transparent"
        outline="none"
        boxShadow="none"
        color="fg"
        _placeholder={{ color: ASK_BAR_PROMPT_COLOR }}
        {...ASK_BAR_WORDS}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || !onEnter) return;
          event.preventDefault();
          onEnter();
        }}
      />
      {onAsk && <AskPill onClick={onAsk} />}
    </AskBarShell>
  );
}
