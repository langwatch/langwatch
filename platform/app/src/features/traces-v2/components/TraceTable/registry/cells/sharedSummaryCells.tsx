import { Text } from "@chakra-ui/react";
import {
  formatCost,
  formatDuration,
  formatTokens,
} from "../../../../utils/formatters";
import { MonoCell } from "../../MonoCell";
import type { CellDef } from "../types";

type ComfortableTextStyle = "xs" | "sm";

export function createCostCell<T extends { totalCost: number }>(
  comfortableTextStyle: ComfortableTextStyle = "xs",
): CellDef<T> {
  return {
    id: "cost",
    label: "Cost",
    render: ({ row }) => <MonoCell>{formatCost(row.totalCost)}</MonoCell>,
    renderComfortable: ({ row }) => (
      <Text textStyle={comfortableTextStyle} color="fg.muted" textAlign="right">
        {formatCost(row.totalCost)}
      </Text>
    ),
  };
}

export function createTokensCell<T extends { totalTokens: number }>(
  comfortableTextStyle: ComfortableTextStyle = "xs",
): CellDef<T> {
  return {
    id: "tokens",
    label: "Tokens",
    render: ({ row }) => <MonoCell>{formatTokens(row.totalTokens)}</MonoCell>,
    renderComfortable: ({ row }) => (
      <Text textStyle={comfortableTextStyle} color="fg.muted" textAlign="right">
        {formatTokens(row.totalTokens)}
      </Text>
    ),
  };
}

export function createDurationCell<T extends { totalDuration: number }>(
  comfortableTextStyle: ComfortableTextStyle = "xs",
): CellDef<T> {
  return {
    id: "duration",
    label: "Duration",
    render: ({ row }) => (
      <MonoCell>{formatDuration(row.totalDuration)}</MonoCell>
    ),
    renderComfortable: ({ row }) => (
      <Text textStyle={comfortableTextStyle} color="fg.muted" textAlign="right">
        {formatDuration(row.totalDuration)}
      </Text>
    ),
  };
}
