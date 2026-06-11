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

/**
 * Short label shown next to the lock, so a glance tells the reader who can see
 * the content without opening the tooltip. Null when the audience is unknown
 * (legacy redaction with no audience label), where the generic copy is enough.
 */
function audienceHint(visibleTo: string | null): string | null {
  if (!visibleTo) return null;
  if (visibleTo === "no one") return "hidden from everyone";
  return `visible to ${visibleTo}`;
}

function tooltipFor(visibleTo: string | null): string {
  if (!visibleTo) {
    return "This field is redacted based on your permissions and project settings.";
  }
  if (visibleTo === "no one") {
    return "Hidden by a privacy policy. No one can see this content.";
  }
  return `Hidden by a privacy policy. Visible to: ${visibleTo}.`;
}

export const RedactedField: React.FC<RedactedFieldProps> = ({
  field,
  children,
  loadingComponent,
}) => {
  const { isRedacted, isLoading, visibleTo } = useFieldRedaction(field);

  if (isLoading || isRedacted === undefined) {
    return <>{loadingComponent ?? <Skeleton height="20px" width="100%" />}</>;
  }

  if (isRedacted) {
    const hint = audienceHint(visibleTo);
    return (
      <Tooltip content={tooltipFor(visibleTo)}>
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
          {hint && <Text>({hint})</Text>}
        </HStack>
      </Tooltip>
    );
  }

  return <>{children}</>;
};
