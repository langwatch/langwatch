import { Box, Flex, Tabs } from "@langwatch/design-system/primitives";
import { Children, isValidElement, useState } from "react";
import type { ReactNode } from "react";

import { usePreference, writePreference } from "../../../lib/storage.ts";
import { CodeBar, CodeFrame } from "../../code/ui/code-block.tsx";
import { CodeBody, CopyAction, sourceFromProps } from "../../code/ui/code-parts.tsx";
import type { CodeSource } from "../../code/ui/code-parts.tsx";
import { languageName, preferenceGroupFor } from "../../code/ui/languages.ts";
import { readingTabList, readingTabTrigger } from "./tabs.tsx";

type Item = { label: string; source?: CodeSource; content?: ReactNode };

function itemsOf({ children }: { children: ReactNode }): Item[] {
  return Children.toArray(children).flatMap((child): Item[] => {
    if (!isValidElement<{ title?: string; children?: ReactNode } & Record<string, unknown>>(child))
      return [];
    if (child.type === CodeGroupItem) {
      return [{ label: String(child.props.title ?? "Example"), content: child.props.children }];
    }
    const source = sourceFromProps(child.props);
    if (!source.code && !source.lines.length) return [];
    return [{ label: source.title || languageName({ lang: source.lang }), source }];
  });
}

/** One frame, authored tabs, one copy action; recognised label sets share a stored choice. */
export function CodeGroup({ children }: { children?: ReactNode }) {
  const items = itemsOf({ children });
  const group = preferenceGroupFor({ labels: items.map((item) => item.label) });
  const stored = usePreference({ key: group });
  const [local, setLocal] = useState<string | null>(null);
  const labels = items.map((item) => item.label);
  const wanted = group ? stored : local;
  const active = labels.find((label) => label.toLowerCase() === wanted?.toLowerCase()) ?? labels[0];
  const current = items.find((item) => item.label === active) ?? items[0];
  if (!current) return null;
  return (
    <CodeFrame>
      <Tabs.Root
        data-docs-preference={group ?? void 0}
        value={active}
        onValueChange={({ value }) => {
          if (group) writePreference({ key: group, value });
          else setLocal(value);
        }}
        variant="line"
        colorPalette="accent"
        size="md"
      >
        <CodeBar>
          <Tabs.List
            css={{
              ...readingTabList,
              flex: 1,
              minWidth: 0,
              borderBottomWidth: 0,
              boxShadow: "none",
            }}
          >
            {items.map((item) => (
              <Tabs.Trigger
                key={item.label}
                value={item.label}
                css={{ ...readingTabTrigger, minHeight: "44px" }}
              >
                {item.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <Flex alignItems="center" flexShrink={0}>
            {current.source ? <CopyAction code={current.source.code} /> : null}
          </Flex>
        </CodeBar>
        {items.map((item) => (
          <Tabs.Content key={item.label} value={item.label} padding="0" data-docs-panel="">
            {item.source ? (
              <CodeBody source={item.source} />
            ) : (
              <Box padding="4">{item.content}</Box>
            )}
          </Tabs.Content>
        ))}
      </Tabs.Root>
    </CodeFrame>
  );
}

/** Some pages nest `CodeGroupItem` around a fence; it renders the fence unchanged. */
export function CodeGroupItem({ children }: { children?: ReactNode; title?: string }) {
  return <>{children}</>;
}
