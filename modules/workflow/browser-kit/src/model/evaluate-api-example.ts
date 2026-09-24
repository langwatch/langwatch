/**
 * A base64 data-URL example for image inputs. Truncated for readability: it
 * shows the "data:<mime>;base64,<payload>" structure the endpoint expects,
 * not a usable image. Callers replace it with their own encoded image.
 */
export const IMAGE_EXAMPLE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...";

/** A placeholder file value for the snippet: truncated on purpose, not a usable file. */
export const FILE_EXAMPLE = "data:application/pdf;base64,JVBERi0xLjQKJcfsj6IK...";

/**
 * Example scalar value for an entry field type, or undefined when not a
 * scalar. The evaluate endpoint only accepts string/number/boolean params,
 * so structured inputs (lists, dicts, chat messages) come from the dataset.
 */
export function exampleParameterValue(type: string): string | number | boolean | undefined {
  switch (type) {
    case "str":
      return "example";
    case "image":
      return IMAGE_EXAMPLE;
    case "file":
      return FILE_EXAMPLE;
    case "float":
      return 0.5;
    case "int":
      return 42;
    case "bool":
      return true;
    default:
      return undefined;
  }
}
