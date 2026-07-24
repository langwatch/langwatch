import { Badge, Text } from "@chakra-ui/react";
import type React from "react";
import { useFilterStore } from "~/features/traces-v2/stores/filterStore";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { TraceListItem } from "../../../../../types/trace";
import type { CellDef } from "../../types";
import { FilterChip } from "../FilterChip";

type Density = "compact" | "comfortable";

/**
 * The managed prompt last used in the trace. The trace summary only
 * carries the prompt *id* + version number, so the human handle is
 * resolved client-side from the project's prompt list (one shared,
 * cached query regardless of how many rows render this cell). Clicking
 * the chip filters by `lastUsedPrompt`; the ↗ opens the prompts page.
 */
const PromptCellView: React.FC<{ row: TraceListItem; density: Density }> = ({
  row,
  density,
}) => {
  const promptId = row.promptId ?? null;
  const { project } = useOrganizationTeamProject();
  const promptsQuery = api.prompts.getAllPromptsForProject.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id && !!promptId, staleTime: 5 * 60_000 },
  );

  if (!promptId) {
    return (
      <Text textStyle={density === "compact" ? "xs" : "sm"} color="fg.subtle">
        —
      </Text>
    );
  }

  const config = promptsQuery.data?.find(
    (p) => p.id === promptId || p.handle === promptId,
  );
  const name = config?.handle ?? config?.name ?? promptId;
  const slug = project?.slug;
  const version = row.promptVersionNumber;

  // openHref/openLabel are all-or-nothing per FilterChipProps — type the pair
  // as that union so the conditional keeps them correlated (a bare spread
  // widens them to independently-optional, which the union rejects).
  const openProps:
    | { openHref: string; openLabel: string }
    | { openHref?: undefined; openLabel?: undefined } = slug
    ? { openHref: `/${slug}/prompts`, openLabel: `View prompt "${name}"` }
    : {};

  return (
    <FilterChip
      onFilter={() =>
        useFilterStore.getState().toggleFacet("lastUsedPrompt", promptId)
      }
      filterLabel={`Filter by prompt "${name}"`}
      {...openProps}
    >
      <Badge
        size={density === "compact" ? "xs" : "sm"}
        variant="surface"
        colorPalette="purple"
        gap={1}
        paddingX={2}
        fontWeight="medium"
      >
        <Text as="span" truncate maxWidth="160px">
          {name}
        </Text>
        {version != null && (
          <Text as="span" textStyle="2xs" color="fg.subtle" flexShrink={0}>
            v{version}
          </Text>
        )}
      </Badge>
    </FilterChip>
  );
};

export const PromptCell = {
  id: "prompt",
  label: "Prompt",
  render: ({ row }) => <PromptCellView row={row} density="compact" />,
  renderComfortable: ({ row }) => (
    <PromptCellView row={row} density="comfortable" />
  ),
} as const satisfies CellDef<TraceListItem>;
