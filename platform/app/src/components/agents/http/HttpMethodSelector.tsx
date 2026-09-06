import { NativeSelect } from "@chakra-ui/react";
import { HTTP_METHODS, type HttpMethod } from "~/optimization_studio/types/dsl";

export type HttpMethodSelectorProps = {
  value: HttpMethod;
  onChange: (method: HttpMethod) => void;
  disabled?: boolean;
};

/**
 * Dropdown selector for HTTP methods (GET, POST, PUT, DELETE, PATCH)
 */
export function HttpMethodSelector({
  value,
  onChange,
  disabled = false,
}: HttpMethodSelectorProps) {
  return (
    <NativeSelect.Root size="sm" width="100px" disabled={disabled}>
      <NativeSelect.Field
        value={value}
        onChange={(e) => onChange(e.target.value as HttpMethod)}
        fontWeight="medium"
        color="blue.600"
      >
        {HTTP_METHODS.map((method) => (
          <option key={method} value={method}>
            {method}
          </option>
        ))}
      </NativeSelect.Field>
      <NativeSelect.Indicator />
    </NativeSelect.Root>
  );
}
