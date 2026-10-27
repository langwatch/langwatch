import { Box } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { TabsMachine } from "./tabs-parts/machine.tsx";

export interface MetricTabItem<Value extends string = string> {
  value: Value;
  /** "Total documents": the name above the figure. */
  label: string;
  /** The live number or summary; read-only, no controls inside (it sits in a tab button). */
  figure: ReactNode;
  /** The panel. */
  content: ReactNode;
  testId?: string;
}

export interface MetricTabsProps<Value extends string = string> {
  value: Value;
  onValueChange: (args: { value: Value }) => void;
  /** One item is allowed; a permission-gated metric is left out. */
  items: readonly MetricTabItem<Value>[];
  /** Names the tablist: "Metrics". */
  label: string;
  /** Default "active": a panel is a read-only query, unmounted when closed. */
  mount?: "lazy" | "active";
  /** Default "manual": arrowing past must not fire a chart query. */
  activationMode?: "automatic" | "manual";
  testId?: string;
}

/**
 * Tabs whose triggers are a live headline figure above a label, selecting the chart or
 * table below. The tab's name is the label followed by the figure's text.
 */
export function MetricTabs<Value extends string>({
  items,
  mount = "active",
  activationMode = "manual",
  ...props
}: MetricTabsProps<Value>) {
  return (
    <TabsMachine
      {...props}
      look="metric"
      mount={mount}
      activationMode={activationMode}
      items={items.map((item) => ({
        value: item.value,
        testId: item.testId,
        panel: item.content,
        trigger: (
          <>
            <Box as="span" textStyle="bodySm" color="fg">
              {item.label}
            </Box>{" "}
            <Box as="span" textStyle="2xl" fontWeight="bold" color="fg">
              {item.figure}
            </Box>
          </>
        ),
      }))}
    />
  );
}
