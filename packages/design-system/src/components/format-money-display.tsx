import { Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { formatMoney } from "../format-money.ts";
import type { Money } from "../type-utils.ts";
import { Tooltip } from "./tooltip.tsx";

export const FormatMoney = ({
  amount,
  currency,
  format = "$0.00[00]",
  tooltip,
}: {
  amount: number;
  currency: Money["currency"];
  format?: string;
  tooltip?: ReactNode;
}) => {
  const formatted = formatMoney({ amount, currency }, format);

  return (
    <Tooltip content={tooltip ?? (formatted.startsWith("<") ? amount : "")}>
      <Text as="span" whiteSpace="nowrap">
        {formatted}
      </Text>
    </Tooltip>
  );
};
