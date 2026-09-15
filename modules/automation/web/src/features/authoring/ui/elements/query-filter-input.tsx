/**
 * Plain trace-query editor without autocomplete/syntax help (pending trace-web surface).
 */

import { Textarea } from "@chakra-ui/react";

export function QueryFilterInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <Textarea
      value={value}
      placeholder={placeholder}
      fontFamily="mono"
      fontSize="sm"
      rows={2}
      autoresize
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
