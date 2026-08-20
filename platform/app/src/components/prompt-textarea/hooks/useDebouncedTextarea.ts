import { useCallback, useEffect, useRef, useState } from "react";
import { useDebounceCallback } from "usehooks-ts";

type UseDebouncedTextareaProps = {
  value: string;
  onChange: (value: string) => void;
};

/**
 * Manages local textarea value with debounced sync to parent.
 * Prevents race conditions by disabling external sync while user is typing.
 */
export const useDebouncedTextarea = ({
  value,
  onChange,
}: UseDebouncedTextareaProps) => {
  // Local value state for immediate UI updates
  const [localValue, setLocalValue] = useState(value);

  // Flag to disable external sync while user is actively typing
  const isTypingRef = useRef(false);

  // Debounced callback to re-enable sync after typing stops
  const enableSyncAfterTyping = useDebounceCallback(() => {
    isTypingRef.current = false;
  }, 300);

  // Debounced onChange to parent
  const debouncedOnChange = useDebounceCallback(onChange, 150);

  // Sync local value ONLY when prop changes from outside AND user is not typing
  useEffect(() => {
    if (isTypingRef.current) return;
    if (value !== localValue) {
      setLocalValue(value);
    }
  }, [value, localValue]);

  // Update local value immediately and debounce parent callback
  const handleValueChange = useCallback(
    (newValue: string) => {
      isTypingRef.current = true;
      enableSyncAfterTyping();
      setLocalValue(newValue);
      debouncedOnChange(newValue);
    },
    [debouncedOnChange, enableSyncAfterTyping],
  );

  // Immediate update without debounce (for programmatic changes like variable insertion)
  const setValueImmediate = useCallback(
    (newValue: string) => {
      setLocalValue(newValue);
      onChange(newValue);
    },
    [onChange],
  );

  return {
    localValue,
    handleValueChange,
    setValueImmediate,
  };
};
