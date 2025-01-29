import { Tooltip } from "@chakra-ui/react";
import { formatMoney } from "../../utils/formatMoney";
import type { Money } from "../../utils/types";
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
    <Tooltip label={tooltip ?? (formatted.startsWith("<") ? amount : "")}>
      {formatted}
    </Tooltip>
  );
};
