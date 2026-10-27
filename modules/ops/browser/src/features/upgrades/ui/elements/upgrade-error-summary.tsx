import { Text } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";

import { summariseError } from "../../model/upgrade-labels.ts";

/** An error as one readable line; hovering shows the full text, the step drawer keeps it too. */
export function UpgradeErrorSummary({ error }: { error: string }) {
  return (
    <Tooltip content={error} positioning={{ placement: "top" }}>
      <Text textStyle="sm" color="fg.error" lineClamp={1}>
        {summariseError(error)}
      </Text>
    </Tooltip>
  );
}
