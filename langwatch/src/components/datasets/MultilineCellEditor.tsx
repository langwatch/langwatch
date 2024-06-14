import React, { useRef, useEffect, useCallback } from "react";
import type { CustomCellEditorProps } from "@ag-grid-community/react";
import { Textarea } from "@chakra-ui/react";

export function MultilineCellEditor(props: CustomCellEditorProps) {
  const { value, onValueChange } = props;
  const updateValue = useCallback(
    (val: string) => {
      onValueChange(val === "" ? null : val);
    },
    [onValueChange]
  );

  useEffect(() => {
    updateValue(value);

    refInput.current?.focus();
  }, [updateValue, value]);

  const refInput = useRef<HTMLTextAreaElement>(null);

  return (
    <Textarea
      borderRadius={0}
      resize="none"
      width="100%"
      height="100%"
      minHeight="0"
      fontSize="13px"
      lineHeight="1.5em"
      value={value || ""}
      ref={refInput}
      onChange={(event) => updateValue(event.target.value)}
    />
  );
}
