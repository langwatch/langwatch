import "../../model/ambient.d.ts";
import { Box, IconButton, Input } from "@chakra-ui/react";
import { Eye, EyeOff } from "lucide-react";
import type { Ref } from "react";
import { useState } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";
import "./auth-front-door.css";
import { SHAPE } from "../../model/front-door-theme.ts";
import { FIELD_FOCUS, FIELD_SURFACE } from "./front-door-field.tsx";

/** Password input with inset reveal toggle; each field keeps its own visibility state. */
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
