import { Callout } from "@langwatch/design-system-internal";

import type { Refusal } from "./api.ts";

/** A refusal as the simulator worded it: what happened, then what to change. */
export const RefusalCallout = ({ refusal }: { refusal: Refusal | undefined }) =>
  refusal === undefined ? null : (
    <Callout tone="error" title={refusal.title}>
      {refusal.detail} {refusal.hint}
    </Callout>
  );
