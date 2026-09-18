import { Box } from "@chakra-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CommandPalette, useCommandBar } from "@langwatch/navigation-browser/surfaces/command-bar";

/**
 * The command palette mounted inline; shared by home and governance overview.
 * Results overlay without changing height. Pressing Cmd+K focuses here instead
 * of raising a second bar.
 */
export function HeroAskField({ placeholder }: { placeholder: string }) {
  const { registerInlinePalette } = useCommandBar();

  // This surface's own query, deliberately NOT the Cmd+K bar's. The two are
  // the same palette but not the same session.
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);

  const focusField = useCallback(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => registerInlinePalette(focusField), [registerInlinePalette, focusField]);

  // Blur closes the results, but not while the click that caused it is landing
  // on a result: the mousedown fires first, and standing down there would
  // unmount the row before its click ever arrived.
  const onBlur = useCallback(() => {
    window.setTimeout(() => {
      if (!fieldRef.current?.contains(document.activeElement)) setFocused(false);
    }, 0);
  }, []);

  const standDown = useCallback(() => {
    setQuery("");
    setFocused(false);
    inputRef.current?.blur();
  }, []);

  return (
    <Box
      ref={fieldRef}
      width="full"
      position="relative"
      background="bg.panel/60"
      borderWidth="1px"
      /* One step darker on light: over the white bloom, border.muted was
         faint enough that the field lost its own edge. Dark keeps the
         quieter hairline; the darker ground already draws the box. */
      borderColor={
        focused
          ? { base: "border.emphasized", _dark: "border" }
          : { base: "border", _dark: "border.muted" }
      }
      borderRadius="16px"
      boxShadow={
        focused
          ? "0 2px 8px rgba(20, 20, 23, 0.08), 0 24px 70px -20px rgba(20, 20, 23, 0.35)"
          : "0 1px 2px rgba(20, 20, 23, 0.04), 0 12px 30px -22px rgba(20, 20, 23, 0.5)"
      }
      transition="border-color 130ms ease, box-shadow 130ms ease"
      onKeyDown={(event) => {
        if (event.key === "Escape") standDown();
      }}
    >
      <CommandPalette
        surface="inline"
        active={focused}
        query={query}
        setQuery={setQuery}
        onDone={standDown}
        inputRef={inputRef}
        onFocus={() => setFocused(true)}
        onBlur={onBlur}
        placeholder={placeholder}
      />
    </Box>
  );
}
