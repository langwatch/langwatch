import React, { useRef, useEffect } from "react";
import type { CustomCellEditorProps } from "ag-grid-react";
import { Textarea } from "@chakra-ui/react";

export const MultilineCellEditor = React.forwardRef(
  (props: CustomCellEditorProps, ref) => {
    const { value, onValueChange } = props;
    const updateValue = (val: string) => {
      onValueChange(val === "" ? null : val);
    };

    useEffect(() => {
      updateValue(value);

      refInput.current?.focus();
    }, []);

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
);
