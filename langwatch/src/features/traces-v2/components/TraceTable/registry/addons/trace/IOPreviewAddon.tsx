import type { TraceListItem } from "../../../../../types/trace";
import { IOPreview } from "../../../IOPreview";
import { Td, Tr } from "../../../TablePrimitives";
import type { AddonDef } from "../../types";

export const IOPreviewAddon: AddonDef<TraceListItem> = {
  id: "io-preview",
  label: "I/O preview",
  shouldRender: ({ row, isExpanded }) => {
    const hasIO = row.input !== null || row.output !== null;
    const isLLM = row.input !== null && row.output !== null;
    return isLLM && hasIO && !isExpanded;
  },
  render: ({ row, density, colSpan, style }) => (
    <Tr>
      <Td
        bg={style.bg}
        colSpan={colSpan}
        padding={`${density.ioPaddingTop} 8px ${density.ioPaddingBottom} 76px`}
        borderLeftWidth="2px"
        borderLeftColor={style.borderColor}
        // The main trace row drops its own bottom border whenever an
        // addon row sits below it (see RegistryRow). Re-apply it here
        // so the next trace row is cleanly separated from the
        // expanded preview — without it the addon and the following
        // trace row read as one blob. `border` (the default token) is
        // strong enough to register against the row tint without
        // looking heavy.
        borderBottomWidth="1px"
        borderBottomColor="border"
        overflow="hidden"
      >
        <IOPreview input={row.input} output={row.output} />
      </Td>
    </Tr>
  ),
};
