/**
 * Search input with a leading search icon, wrapping InputGroup. Renders with
 * `role="searchbox"` for accessibility and testability.
 */

import type { BoxProps, InputProps } from "@chakra-ui/react";
import { Input } from "@chakra-ui/react";
import { Search } from "lucide-react";
import * as React from "react";

import { InputGroup } from "./input-group.tsx";

export interface SearchInputProps extends InputProps {
  /** Layout of the icon-and-input group; input props still target the input. */
  containerProps?: BoxProps;
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput({ containerProps, ...props }, ref) {
    return (
      <InputGroup
        {...containerProps}
        startElement={
          <span aria-hidden="true">
            <Search size={14} aria-hidden="true" />
          </span>
        }
        startOffset="2px"
      >
        <Input ref={ref} type="search" aria-label={props["aria-label"] ?? "Search"} {...props} />
      </InputGroup>
    );
  },
);
