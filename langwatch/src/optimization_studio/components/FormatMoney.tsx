import { Tooltip } from "@chakra-ui/react";
import { formatMoney } from "../../utils/formatMoney";
import type { Money } from "../../utils/types";

export const FormatMoney = ({
  amount,
  currency,
  format = "$0.00[00]",
}: {
  amount: number;
  currency: Money["currency"];
  format?: string;
}) => {
  const formatted = formatMoney({ amount, currency }, format);

  return (
    <Tooltip label={formatted.startsWith("<") ? amount : ""}>
      {formatted}
    </Tooltip>
  );
};
