import { Text } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { formatMoney } from "../../../model/format-money";
import type { Money } from "../../../model/utils/types";

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
