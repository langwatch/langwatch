/**
 * A widget's (i) on a board card, faint beside the title: hover or focus shows what the widget
 * is for and why it matters, then what its data is missing, so the card itself carries only
 * the title and a clean face (features/dashboards/WIDGET_STANDARD.md).
 */

import { IconButton, Text, VStack } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Info } from "lucide-react";

import {
  completenessNotes,
  hasUnpricedCost,
  type WidgetCompleteness,
} from "../../../../model/dashboard-widget/widget-completeness.ts";
import { Link } from "../../../../ui/elements/analytics-link.tsx";

/** Where a project prices the models its traces use. */
const MODEL_COSTS_PATH = "/settings/model-costs";

export function WidgetInfoTip({
  name,
  description,
  completeness = null,
}: {
  name: string;
  description?: string;
  /** What the widget's queries reported; its notes show when the data is partial. */
  completeness?: WidgetCompleteness | null;
}) {
  const notes = completenessNotes(completeness);
  return (
    <Tooltip
      content={
        <VStack align="stretch" gap={2}>
          {description && <Text>{description}</Text>}
          {notes.length > 0 && (
            <VStack
              align="stretch"
              gap={1}
              data-testid="widget-completeness-notes"
              {...(description
                ? { borderTopWidth: "1px", borderColor: "border", paddingTop: 2 }
                : {})}
            >
              {notes.map((note) => (
                <Text key={note}>{note}</Text>
              ))}
              {hasUnpricedCost(completeness) && (
                <Link
                  href={MODEL_COSTS_PATH}
                  color="fg"
                  fontWeight="medium"
                  textDecoration="underline"
                >
                  Add a price
                </Link>
              )}
            </VStack>
          )}
        </VStack>
      }
      showArrow
      interactive={notes.length > 0}
      positioning={{ placement: "bottom-start" }}
      contentProps={{ maxWidth: "xs", whiteSpace: "pre-line" }}
    >
      <IconButton
        aria-label={`About ${name}`}
        variant="ghost"
        size="xs"
        flexShrink={0}
        color="fg.subtle"
        opacity={0.7}
        _hover={{ opacity: 1, color: "fg", background: "bg.muted" }}
      >
        <Info size={13} aria-hidden />
      </IconButton>
    </Tooltip>
  );
}
