import type { TraceListItem } from "../../../../../types/trace";
import { IOPreview } from "../../../IOPreview";
import { Td, Tr } from "../../../TablePrimitives";
import type { AddonDef } from "../../types";

export const IOPreviewAddon: AddonDef<TraceListItem> = {
  id: "io-preview",
  label: "I/O preview",
  shouldRender: ({ row, isExpanded, densityMode }) => {
    if (densityMode === "comfortable") return false;
    const hasIO = row.input !== null || row.output !== null;
    const isLLM = row.input !== null && row.output !== null;
    return isLLM && hasIO && !isExpanded;
  },
  render: ({ row, density, colSpan, style }) => (
    <Tr borderBottomWidth="1px" borderBottomColor="border.muted">
      <Td
        bg={style.bg}
        colSpan={colSpan}
        padding={`${density.ioPaddingTop} 8px ${density.ioPaddingBottom} 76px`}
        borderLeftWidth="2px"
        borderLeftColor={style.borderColor}
      >
        <IOPreview input={row.input} output={row.output} />
      </Td>
    </Tr>
  ),
};
