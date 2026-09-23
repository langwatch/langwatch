import { Text } from "@chakra-ui/react";
import { formatMoney } from "@langwatch/design-system/format-money";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { Money } from "@langwatch/design-system/type-utils";
import type { ReactNode } from "react";

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
