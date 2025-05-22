import { Lock } from "react-feather";
import { HStack, Text, Icon, Skeleton } from "@chakra-ui/react";
import { Tooltip } from "./tooltip";
import { useFieldRedaction } from "~/hooks/useFieldRedaction";
import React from "react";

interface RedactedFieldProps {
  field: "input" | "output";
  children: React.ReactNode;
  loadingComponent?: React.ReactNode;
}

export const RedactedField: React.FC<RedactedFieldProps> = ({ field, children, loadingComponent }) => {
  const { isRedacted, isLoading } = useFieldRedaction(field);

  if (isLoading || isRedacted === undefined) {
    return <>{loadingComponent ?? <Skeleton height="20px" width="100%" />}</>;
  }

  if (isRedacted) {
    return (
      <Tooltip content="This field is redacted based on your permissions and project settings.">
        <HStack
          color="gray.500"
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
