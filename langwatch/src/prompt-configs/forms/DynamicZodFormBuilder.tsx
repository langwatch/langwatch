import { z } from "zod/v4";
import { useFormContext } from "react-hook-form";

export type SupportedInputType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array";

/**
 * Dynamic zod form built from a given schema and a mapping of input components
 * Responsibilities: Render form fields based on Zod schema with custom components
 */
export function DynamicZodFormBuilder({
  schema,
  components,
}: {
  schema:
    | z.ZodObject<any>
    | z.ZodArray<any>
    | z.ZodString
    | z.ZodNumber
    | z.ZodBoolean;
  components: Record<SupportedInputType, React.ReactNode>;
}) {
  const { register } = useFormContext();

  const getComponentForType = (
    fieldSchema: z.ZodTypeAny,
    fieldName: string,
  ): React.ReactNode => {
    const fieldSchema_ =
      fieldSchema instanceof z.ZodOptional ? fieldSchema.unwrap() : fieldSchema;

    if (fieldSchema_ instanceof z.ZodDefault) {
      return getComponentForType(
        fieldSchema_.def.innerType as z.ZodDefault,
        fieldName,
      );
    } else if (fieldSchema_ instanceof z.ZodString) {
      return components.string ?? <input {...register(fieldName)} />;
    } else if (fieldSchema_ instanceof z.ZodNumber) {
      return (
        components.number ?? (
          <input
            type="number"
            {...register(fieldName, { setValueAs: (val) => +val })}
          />
        )
      );
    } else if (fieldSchema_ instanceof z.ZodBoolean) {
      return (
        components.boolean ?? <input type="checkbox" {...register(fieldName)} />
      );
    } else if (fieldSchema_ instanceof z.ZodObject) {
      return components.object ?? <div>Object</div>;
    } else if (fieldSchema_ instanceof z.ZodArray) {
      return components.array ?? <div>Array</div>;
    }

    return <div>Unsupported field type</div>;
  };

  // Handle ZodObject - render each field with its name
  if (schema instanceof z.ZodObject) {
    return (
      <div>
        {Object.keys(schema.shape).map((key) => (
          <div key={key}>
            <label>{key}</label>
            {getComponentForType(schema.shape[key], key)}
          </div>
        ))}
      </div>
    );
  }

  // Handle ZodArray - render the array component directly
  if (schema instanceof z.ZodArray) {
    return <div>{getComponentForType(schema, "")}</div>;
  }

  // Handle simple types (string, number, boolean) - render without label
  return <div>{getComponentForType(schema, "")}</div>;
}
