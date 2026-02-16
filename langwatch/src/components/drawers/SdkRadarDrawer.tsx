import {
  Badge,
  Box,
  Button,
  ClientOnly,
  CodeBlock,
  createShikiAdapter,
  Heading,
  HStack,
  IconButton,
  Spacer,
  Table,
  Tabs,
  Text,
  useTabs,
  VStack,
} from "@chakra-ui/react";
import { LuBellOff, LuExternalLink } from "react-icons/lu";
import numeral from "numeral";
import semver from "semver";
import { useMemo } from "react";
import type { HighlighterGeneric } from "shiki";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useDrawer } from "~/hooks/useDrawer";
import { useSdkRadarUpdateSnooze } from "~/hooks/useSdkRadarUpdateSnooze";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { api } from "~/utils/api";
import { Drawer } from "../ui/drawer";
import { Link } from "../ui/link";
import { useColorMode } from "../ui/color-mode";

export function SdkRadarDrawer() {
  const { project } = useOrganizationTeamProject();
  const { closeDrawer } = useDrawer();
  const { snooze } = useSdkRadarUpdateSnooze(project?.id);

  const stats = api.sdkRadar.getVersionStats.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  const handleSnooze = () => {
    snooze();
    closeDrawer();
  };

  return (
    <Drawer.Root
      open={true}
      placement="end"
      size="lg"
      onOpenChange={() => closeDrawer()}
    >
      <Drawer.Content>
        <Drawer.Header>
          <HStack width="full">
            <Heading size="md">SDK Radar</Heading>
            <Spacer />
            {stats.data?.hasOutdated && (
              <Button size="xs" variant="ghost" onClick={handleSnooze}>
                <LuBellOff size={14} />
                Snooze 30 days
              </Button>
            )}
          </HStack>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          {stats.data?.sdks.length === 0 && (
            <Text color="fg.muted">No SDK usage data found.</Text>
          )}

          <VStack gap={6} width="full" align="start">
            {stats.data?.sdks
              .toSorted((a, b) => {
                const aOutdated = a.versions.some((v) => v.isOutdated);
                const bOutdated = b.versions.some((v) => v.isOutdated);
                if (aOutdated && !bOutdated) return -1;
                if (!aOutdated && bOutdated) return 1;
                return 0;
              })
              .map((sdk) => (
                <SdkSection
                  key={`${sdk.sdkName}:${sdk.sdkLanguage}`}
                  sdk={sdk}
                />
              ))}
          </VStack>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

interface SdkSectionProps {
  sdk: {
    sdkName: string;
    sdkLanguage: string;
    displayName: string;
    latestVersion: string;
    releasesUrl: string;
    docsUrl: string;
    installCommands: Record<string, string>;
    versions: {
      version: string;
      count: number;
      lastEventTimestamp: number | null;
      isOutdated: boolean;
    }[];
  };
}

function SdkSection({ sdk }: SdkSectionProps) {
  const hasOutdated = sdk.versions.some((v) => v.isOutdated);
  const hasVersionAhead = sdk.versions.some(
    (v) => semver.valid(v.version) && semver.gt(v.version, sdk.latestVersion),
  );

  return (
    <Box
      width="full"
      borderWidth="1px"
      borderColor={hasOutdated ? "orange.300" : "border"}
      borderRadius="lg"
      overflow="hidden"
    >
      <VStack gap={0} width="full" align="start">
        <HStack gap={2} width="full" padding={4} paddingBottom={3}>
          <Text fontWeight="medium">{sdk.displayName}</Text>
          {hasOutdated && (
            <Badge colorPalette="orange" size="sm">
              Update available
            </Badge>
          )}
          {!hasVersionAhead && (
            <Badge colorPalette="green" size="sm">
              Latest: {sdk.latestVersion}
            </Badge>
          )}
          <Spacer />
          <HStack gap={3}>
            <Link
              href={sdk.releasesUrl}
              fontSize="xs"
              color="fg.muted"
              _hover={{ color: "orange.500" }}
              target="_blank"
              rel="noopener noreferrer"
            >
              Releases <LuExternalLink size={10} />
            </Link>
            <Link
              href={sdk.docsUrl}
              fontSize="xs"
              color="fg.muted"
              _hover={{ color: "orange.500" }}
              target="_blank"
              rel="noopener noreferrer"
            >
              Docs <LuExternalLink size={10} />
            </Link>
          </HStack>
        </HStack>

        {hasOutdated && Object.keys(sdk.installCommands).length > 0 && (
          <Box width="full" paddingX={4} paddingBottom={3}>
            <InstallCommandBlock installCommands={sdk.installCommands} />
          </Box>
        )}

        <Box width="full" paddingX={4} paddingBottom={4}>
          <Table.Root
            variant="outline"
            size="sm"
            width="full"
            borderRadius="md"
          >
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Version</Table.ColumnHeader>
                <Table.ColumnHeader>Status</Table.ColumnHeader>
                <Table.ColumnHeader>Last Event</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="right">
                  Events (7d)
                </Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {sdk.versions
                .toSorted((a, b) => {
                  if (a.isOutdated && !b.isOutdated) return -1;
                  if (!a.isOutdated && b.isOutdated) return 1;
                  return 0;
                })
                .map((v) => (
                  <Table.Row
                    key={v.version}
                    bg={v.isOutdated ? "orange.50" : undefined}
                    _dark={v.isOutdated ? { bg: "orange.500/10" } : undefined}
                  >
                    <Table.Cell fontFamily="mono" fontSize="xs">
                      {v.version}
                    </Table.Cell>
                    <Table.Cell>
                      {v.isOutdated ? (
                        <Badge colorPalette="orange" size="sm">
                          Outdated
                        </Badge>
                      ) : (
                        <Badge colorPalette="green" size="sm">
                          Up to date
                        </Badge>
                      )}
                    </Table.Cell>
                    <Table.Cell fontSize="xs" color="fg.muted">
                      {v.lastEventTimestamp
                        ? formatTimeAgo(v.lastEventTimestamp)
                        : "-"}
                    </Table.Cell>
                    <Table.Cell textAlign="right" fontSize="xs">
                      {numeral(v.count).format("0,0")}
                    </Table.Cell>
                  </Table.Row>
                ))}
            </Table.Body>
          </Table.Root>
        </Box>
      </VStack>
    </Box>
  );
}

function InstallCommandBlock({
  installCommands,
}: {
  installCommands: Record<string, string>;
}) {
  const { colorMode } = useColorMode();
  const tabItems = Object.entries(installCommands).map(([key, code]) => ({
    key,
    title: key,
    code,
  }));

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

  if (tabItems.length === 0) return null;

  const activeTab = tabItems.find((t) => t.key === tabs.value) ?? tabItems[0]!;
  const otherTabs = tabItems.filter((t) => t.key !== tabs.value);

  return (
    <Tabs.RootProvider value={tabs} size="sm" variant="line" width="full">
      <CodeBlock.AdapterProvider value={shikiAdapter}>
        <ClientOnly>
          {() => (
            <CodeBlock.Root
              code={activeTab.code}
              language="bash"
              size="sm"
              bg="bg.muted"
              borderRadius="md"
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
              <CodeBlock.Content>
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
