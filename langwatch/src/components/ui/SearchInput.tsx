/**
 * Search input with a leading search icon.
 *
 * Wraps the existing InputGroup with a Search icon in the start element.
 * Renders with `role="searchbox"` for accessibility and testability.
 */

import type { InputProps } from "@chakra-ui/react";
import { Input } from "@chakra-ui/react";
import { Search } from "lucide-react";
import * as React from "react";
import { InputGroup } from "./input-group";

export const SearchInput = React.forwardRef<HTMLInputElement, InputProps>(
  function SearchInput(props, ref) {
    return (
      <InputGroup
        startElement={
          <span>
            <Search size={14} aria-label="Search" role="img" />
          </span>
        }
      >
        <Input ref={ref} role="searchbox" {...props} />
      </InputGroup>
    );
  },
);
