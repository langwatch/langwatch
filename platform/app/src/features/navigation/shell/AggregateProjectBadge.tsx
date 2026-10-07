import { Badge } from "@chakra-ui/react";

/**
 * Marks an aggregate project (ADR-144) wherever projects are picked: it reads
 * its member projects' traces and takes no data of its own, so an admin has
 * to be able to tell it from the projects that do. Styled as the Personal
 * badge beside it in the scope control.
 */
export function AggregateProjectBadge() {
  return (
    <Badge
      variant="outline"
      fontSize="10px"
      color="fg.muted"
      borderRadius="md"
      flexShrink={0}
    >
      Aggregate
    </Badge>
  );
}
