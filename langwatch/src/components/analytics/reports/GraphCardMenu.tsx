import { Button } from "@chakra-ui/react";
import { Edit, Grid, MoreVertical, Trash2 } from "lucide-react";
import { useRouter } from "next/router";
import { Menu } from "~/components/ui/menu";

type SizeOption = "1x1" | "2x1" | "1x2" | "2x2";

const sizeOptions: {
  value: SizeOption;
  label: string;
  colSpan: number;
  rowSpan: number;
}[] = [
  { value: "1x1", label: "Small (1x1)", colSpan: 1, rowSpan: 1 },
  { value: "2x1", label: "Wide (2x1)", colSpan: 2, rowSpan: 1 },
  { value: "1x2", label: "Tall (1x2)", colSpan: 1, rowSpan: 2 },
  { value: "2x2", label: "Large (2x2)", colSpan: 2, rowSpan: 2 },
];

const getCurrentSize = (colSpan: number, rowSpan: number): SizeOption => {
  if (colSpan === 2 && rowSpan === 2) return "2x2";
  if (colSpan === 2 && rowSpan === 1) return "2x1";
  if (colSpan === 1 && rowSpan === 2) return "1x2";
  return "1x1";
};

interface GraphCardMenuProps {
  graphId: string;
  projectSlug: string;
  dashboardId?: string;
  colSpan: number;
  rowSpan: number;
  onSizeChange: (size: SizeOption) => void;
  onDelete: () => void;
  isDeleting: boolean;
}

export function GraphCardMenu({
  graphId,
  projectSlug,
  dashboardId,
  colSpan,
  rowSpan,
  onSizeChange,
  onDelete,
  isDeleting,
}: GraphCardMenuProps) {
  const router = useRouter();
  const currentSize = getCurrentSize(colSpan, rowSpan);

  const editUrl = `/${projectSlug}/analytics/custom/${graphId}${dashboardId ? `?dashboard=${dashboardId}` : ""}`;

  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button variant="ghost" loading={isDeleting}>
          <MoreVertical />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item
          value="edit"
          onClick={() => {
            void router.push(editUrl);
          }}
        >
          <Edit /> Edit Graph
        </Menu.Item>

        <Menu.Root positioning={{ placement: "right-start", gutter: 2 }}>
          <Menu.TriggerItem value="size">
            <Grid /> Size ({currentSize})
          </Menu.TriggerItem>
          <Menu.Content>
            {sizeOptions.map((option) => (
              <Menu.Item
                key={option.value}
                value={option.value}
                onClick={() => onSizeChange(option.value)}
              >
                {option.label}
                {option.value === currentSize && " ✓"}
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Root>

        <Menu.Item value="delete" color="red.600" onClick={onDelete}>
          <Trash2 /> Delete Graph
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}

export { sizeOptions, getCurrentSize };
export type { SizeOption };
