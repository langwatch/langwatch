import { Flex, Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../../types/trace";
import { Td, Tr } from "../../../TablePrimitives";
import type { AddonDef } from "../../types";

export const ErrorDetailAddon: AddonDef<TraceListItem> = {
  id: "error-detail",
  label: "Error detail",
  shouldRender: ({ row, densityMode }) => {
    if (densityMode === "comfortable") return false;
    return Boolean(row.error);
  },
  render: ({ row, density, colSpan, style }) => (
    <Tr borderBottomWidth="1px" borderBottomColor="border.muted">
      <Td
        bg={style.bg}
        colSpan={colSpan}
        paddingLeft={6}
        paddingRight={2}
        paddingTop={0}
        paddingBottom={density.errorDetailPaddingBottom}
        borderLeftWidth="2px"
        borderLeftColor={style.borderColor}
      >
        <Flex align="center" gap={1}>
          <Text textStyle="xs" color="fg.subtle" flexShrink={0}>
            ╰
          </Text>
          <Text textStyle="xs" fontFamily="mono" color="red.fg" truncate>
            ▸ {row.errorSpanName ?? "(root)"} — {row.error}
          </Text>
        </Flex>
      </Td>
    </Tr>
  ),
};
