/// <reference path="../../model/ambient.d.ts" />
import { Box, IconButton, Input } from "@chakra-ui/react";
import { Eye, EyeOff } from "lucide-react";
import type { Ref } from "react";
import { useState } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";
import "./auth-front-door.css";
import { SHAPE } from "../../model/front-door-theme";
import { FIELD_FOCUS, FIELD_SURFACE } from "./front-door-field";

/**
 * A password box with its own reveal toggle, sitting INSIDE the box.
 *
 * The toggle used to be a button beside the input, which cost the field the
 * width of a button and read as a separate control that happened to be next to
 * it. Inset, it belongs to the field it acts on — which matters most where
 * there are two of them, because "show" beside a pair of stacked boxes does
 * not say which one it means.
 *
 * Each box keeps its own state for the same reason: revealing what you typed
 * is a question about one field. A single toggle over a password and its
 * confirmation would answer it for both, which defeats confirming.
 *
 * The input reserves room for the button rather than overlapping it, so a long
 * password scrolls under the text and never under the icon.
 */
export function PasswordInput({
  id,
  autoComplete,
  registration,
  inputRef,
  onFocus,
}: {
  id: string;
  /** `current-password` where one is being given, `new-password` where one is
   *  being chosen — password managers read this and nothing else. */
  autoComplete: "current-password" | "new-password";
  registration: UseFormRegisterReturn;
  /** For a field the screen wants to focus once the entrance has settled. */
  inputRef?: Ref<HTMLInputElement>;
  /** Where reaching the field is itself the signal — the sign-up step opens
   *  the rest of the form on it. */
  onFocus?: () => void;
}) {
  const [isRevealed, setIsRevealed] = useState(false);

  return (
    <Box position="relative" width="full">
      <Input
        id={id}
        type={isRevealed ? "text" : "password"}
        fontSize={{ base: "16px", md: "14px" }}
        minHeight="44px"
        borderRadius={SHAPE.field}
        autoComplete={autoComplete}
        paddingInlineEnd="42px"
        {...FIELD_SURFACE}
        _focusVisible={FIELD_FOCUS}
        {...registration}
        onFocus={onFocus}
        ref={(node: HTMLInputElement | null) => {
          registration.ref(node);
          if (typeof inputRef === "function") inputRef(node);
          else if (inputRef) {
            (inputRef as { current: HTMLInputElement | null }).current = node;
          }
        }}
      />
      <IconButton
        type="button"
        variant="ghost"
        size="xs"
        position="absolute"
        insetInlineEnd="6px"
        top="50%"
        transform="translateY(-50%)"
        color="fg.muted"
        aria-label={isRevealed ? "Hide password" : "Show password"}
        onClick={() => setIsRevealed((revealed) => !revealed)}
      >
        {isRevealed ? <EyeOff size={16} /> : <Eye size={16} />}
      </IconButton>
    </Box>
  );
}
