import { Text } from "@chakra-ui/react";
import type { TraceListItem } from "../../../../../types/trace";
import { formatTokens } from "../../../../../utils/formatters";
import { MonoCell } from "../../../MonoCell";
import type { CellDef } from "../../types";

export const TokensCell: CellDef<TraceListItem> = {
  id: "tokens",
  label: "Tokens",
  render: ({ row }) => <MonoCell>{formatTokens(row.totalTokens)}</MonoCell>,
  renderComfortable: ({ row }) => (
    <Text textStyle="sm" color="fg.muted" textAlign="right">
      {formatTokens(row.totalTokens)}
    </Text>
  ),
};
