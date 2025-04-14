import { Input, Text, type InputProps, VStack } from "@chakra-ui/react";
import { useState, type ReactNode } from "react";
import { VerticalFormControl } from "~/components/VerticalFormControl";

interface EditableTextFieldProps extends InputProps {
  fontWeight?: number;
  label?: ReactNode;
}

export function EditableTextField({
  fontWeight = 500,
  label,
  ...props
}: EditableTextFieldProps) {
  const [isEditing, setIsEditing] = useState(false);

  const hasValue = props.value !== undefined && props.value !== "";
  const value = props.value ?? props.placeholder;

  const content = (
    <>
      {isEditing ? (
        <Input
          {...props}
          marginLeft={1}
          fontWeight={fontWeight}
          variant="outline"
          background="transparent"
          value={value}
          borderRadius={5}
          paddingLeft={1}
          margin={0}
          size="sm"
          onBlur={() => {
            setIsEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setIsEditing(false);
            }
          }}
        />
      ) : (
        <Text
          fontWeight={fontWeight}
          {...(!hasValue && {
            color: "gray.400",
            fontStyle: "italic",
            cursor: "pointer",
          })}
        >
          {value}
        </Text>
      )}
    </>
  );

  return label ? (
    <VerticalFormControl
      label={label}
      onClick={() => {
        setIsEditing(true);
      }}
    >
      {content}
    </VerticalFormControl>
  ) : (
    content
  );
}
