/** The quiet "ENT" chip on whatever the Enterprise plan gates, alike in the sidebar and a title. */
import { Badge } from "@chakra-ui/react";

export interface EnterprisePillProps {
  "data-testid"?: string;
}

export function EnterprisePill({ "data-testid": testId }: EnterprisePillProps) {
  return (
    <Badge
      title="Enterprise plan feature"
      variant="outline"
      textStyle="micro"
      fontWeight="semibold"
      letterSpacing="0.06em"
      textTransform="uppercase"
      color="fg.muted"
      borderWidth="1px"
      borderColor="border"
      borderRadius="sm"
      paddingX={1}
      paddingY="1px"
      lineHeight="1.3"
      flexShrink={0}
      data-testid={testId}
    >
      ENT
    </Badge>
  );
}
