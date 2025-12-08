import {
  ClientOnly,
  CodeBlock,
  createShikiAdapter,
  IconButton,
  Tabs,
  useTabs,
} from "@chakra-ui/react";
import type React from "react";
import { useMemo } from "react";
import type { HighlighterGeneric } from "shiki";
import { useColorMode } from "../../../../../components/ui/color-mode";
import type { InstallMatrix } from "../../../regions/observability/codegen/registry";

interface InstallPreviewProps {
  install?: InstallMatrix;
}

export function InstallPreview({
  install,
}: InstallPreviewProps): React.ReactElement | null {
  const { colorMode } = useColorMode();
  const tabItems: { key: string; title: string; code: string }[] = [];

  if (install) {
    Object.entries(install).forEach(([_, value]) => {
      Object.entries(value as Record<string, string>).forEach(([key, val]) => {
        tabItems.push({ key: key, title: key, code: val });
      });
    });
  }

  const tabs = useTabs({ defaultValue: tabItems[0]?.key });

  const shikiAdapter = useMemo(() => {
    return createShikiAdapter<HighlighterGeneric<any, any>>({
      async load() {
        const { createHighlighter } = await import("shiki");
        return createHighlighter({
          langs: ["bash"],
          themes: ["github-dark", "github-light"],
        });
      },
      theme: colorMode === "dark" ? "github-dark" : "github-light",
    });
  }, [colorMode]);

  if (tabItems[0] && !tabItems.find((t) => t.key === tabs.value)) {
    tabs.setValue(tabItems[0].key);
  }

  if (tabItems.length === 0) return null;

  const activeTab = tabItems.find((t) => t.key === tabs.value) ?? tabItems[0]!;
  const otherTabs = tabItems.filter((t) => t.key !== tabs.value);

  return (
    <Tabs.RootProvider value={tabs} size="sm" variant="line">
      <CodeBlock.AdapterProvider value={shikiAdapter}>
        <ClientOnly>
          {() => (
            <CodeBlock.Root
              code={activeTab.code}
              language="bash"
              size="sm"
              transition="all 0.3s ease"
              bg="bg.subtle/20"
              meta={{ colorScheme: colorMode }}
            >
              <CodeBlock.Header borderBottomWidth="1px">
                <Tabs.List w="full" border="0" ms="-1">
                  {tabItems.map((t) => (
                    <Tabs.Trigger
                      colorPalette="teal"
                      key={t.key}
                      value={t.key}
                      textStyle="xs"
                    >
                      {t.title}
                    </Tabs.Trigger>
                  ))}
                </Tabs.List>
                <CodeBlock.CopyTrigger asChild>
                  <IconButton variant="ghost" size="2xs" mr={"-4px"}>
                    <CodeBlock.CopyIndicator />
                  </IconButton>
                </CodeBlock.CopyTrigger>
              </CodeBlock.Header>
              <CodeBlock.Content
                transition="background-color 0.3s ease, color 0.3s ease"
                css={{
                  "& pre, & code": {
                    transition: "background-color 0.3s ease, color 0.3s ease",
                  },
                }}
              >
                {otherTabs.map((t) => (
                  <Tabs.Content key={t.key} value={t.key} />
                ))}
                <Tabs.Content pt="1" value={activeTab.key}>
                  <CodeBlock.Code>
                    <CodeBlock.CodeText />
                  </CodeBlock.Code>
                </Tabs.Content>
              </CodeBlock.Content>
            </CodeBlock.Root>
          )}
        </ClientOnly>
      </CodeBlock.AdapterProvider>
    </Tabs.RootProvider>
  );
}
