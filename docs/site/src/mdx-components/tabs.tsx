import type { SystemStyleObject } from "@langwatch/design-system/primitives";
import { Tabs as ChakraTabs } from "@langwatch/design-system/primitives";
import { Children, isValidElement, useState } from "react";
import type { ReactNode } from "react";

import { preferenceGroupFor } from "../code/languages.ts";
import { usePreference, writePreference } from "../lib/storage.ts";

/** Docs reading treatment: neutral labels, a 2px accent underline, 44px triggers. */
export const readingTabList = {
  overflowX: "auto",
  flexWrap: "nowrap",
  scrollbarWidth: "thin",
} satisfies SystemStyleObject;

export const readingTabTrigger = {
  color: "fg.muted",
  fontWeight: "500",
  whiteSpace: "nowrap",
  flexShrink: 0,
  minHeight: "44px",
  paddingX: "3",
  fontSize: "14px",
  lineHeight: "20px",
  _hover: { color: "fg", bg: "bg.hover" },
  "&[data-selected]": { color: "fg", fontWeight: "600" },
} satisfies SystemStyleObject;

type TabProps = { title?: string; children?: ReactNode };

/** A `Tabs` child: it only carries its title and content to the parent. */
export function Tab({ children }: TabProps) {
  return <>{children}</>;
}

export function Tabs({ children }: { children?: ReactNode }) {
  const tabs = Children.toArray(children).flatMap((child, index) =>
    isValidElement<TabProps>(child)
      ? [{ label: child.props.title ?? `Tab ${index + 1}`, content: child.props.children }]
      : [],
  );
  const labels = tabs.map((tab) => tab.label);
  const group = preferenceGroupFor({ labels });
  const stored = usePreference({ key: group });
  const [local, setLocal] = useState<string | null>(null);
  const wanted = group ? stored : local;
  const active = labels.find((label) => label.toLowerCase() === wanted?.toLowerCase()) ?? labels[0];
  if (tabs.length === 0) return null;
  return (
    <ChakraTabs.Root
      data-docs-preference={group ?? void 0}
      value={active}
      onValueChange={({ value }) =>
        group ? writePreference({ key: group, value }) : setLocal(value)
      }
      variant="line"
      colorPalette="accent"
      marginY="6"
    >
      <ChakraTabs.List css={readingTabList}>
        {tabs.map((tab) => (
          <ChakraTabs.Trigger key={tab.label} value={tab.label} css={readingTabTrigger}>
            {tab.label}
          </ChakraTabs.Trigger>
        ))}
      </ChakraTabs.List>
      {tabs.map((tab) => (
        <ChakraTabs.Content
          key={tab.label}
          value={tab.label}
          paddingX="0"
          paddingTop="4"
          paddingBottom="0"
          data-docs-panel=""
        >
          {tab.content}
        </ChakraTabs.Content>
      ))}
    </ChakraTabs.Root>
  );
}
