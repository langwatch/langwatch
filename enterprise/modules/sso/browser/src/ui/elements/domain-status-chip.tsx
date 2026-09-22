// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * One domain's standing, in a word. A settled domain carries a tick as well
 * as its colour: green alone is a channel some readers do not have.
 */
import { Badge } from "@chakra-ui/react";
import { Check } from "lucide-react";

import type { DomainChip } from "../../model/domain-proof-chip.ts";

const PALETTE = { good: "green", warning: "yellow", bad: "red" } as const;

export function DomainStatusChip({ label, tone, title }: DomainChip) {
  return (
    <Badge size="sm" colorPalette={PALETTE[tone]} title={title}>
      {tone === "good" && <Check size={12} aria-hidden="true" />}
      {label}
    </Badge>
  );
}
