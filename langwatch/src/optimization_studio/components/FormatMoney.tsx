import { formatMoney } from "../../utils/formatMoney";
import type { Money } from "../../utils/types";
import type { ReactNode } from "react";
import { Tooltip } from "../../components/ui/tooltip";

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
      {formatted}
    </Tooltip>
  );
};
