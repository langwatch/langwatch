import { HStack, Icon, Skeleton, Text } from "@chakra-ui/react";
import type React from "react";
import { Lock } from "react-feather";
import { useFieldRedaction } from "~/hooks/useFieldRedaction";
import { Tooltip } from "./tooltip";

interface RedactedFieldProps {
  field: "input" | "output";
  children: React.ReactNode;
  loadingComponent?: React.ReactNode;
}

export const RedactedField: React.FC<RedactedFieldProps> = ({
  field,
  children,
  loadingComponent,
}) => {
  const { isRedacted, isLoading } = useFieldRedaction(field);

  if (isLoading || isRedacted === undefined) {
    return <>{loadingComponent ?? <Skeleton height="20px" width="100%" />}</>;
  }

  if (isRedacted) {
    return (
      <Tooltip content="This field is redacted based on your permissions and project settings.">
        <HStack
          color="fg.muted"
          fontStyle="italic"
          fontSize="sm"
          gap={1}
          cursor="default"
          display="inline-flex"
        >
          <Icon as={Lock} boxSize={3} />
          <Text>Redacted</Text>
        </HStack>
      </Tooltip>
    );
  }

  return <>{children}</>;
};
