import { Box, Button, chakra, Flex, Heading, HStack, Stack, Text } from "@chakra-ui/react";
import { SegmentedControl } from "@langwatch/design-system/segmented-control";
import { useEffect, useState, type JSX } from "react";
import { PropsForm } from "./props-form.tsx";
import { prepareMailDocument, WIDTHS, type Rendered, type TemplateSummary } from "./studio-shared.ts";

const HtmlButton = chakra("button");
const HtmlIframe = chakra("iframe");

export interface InspectViewProps {
  templates: TemplateSummary[];
  selected: { id: string; fixture: string } | null;
  currentProps: unknown;
  onPropsChange: (next: unknown) => void;
  onSelect: (templateId: string, fixtureName: string) => void;
  previewDark: boolean;
  width: keyof typeof WIDTHS;
  onWidthChange: (next: keyof typeof WIDTHS) => void;
}

export const InspectView = ({
  templates,
  selected,
  currentProps,
  onPropsChange,
  onSelect,
  previewDark,
  width,
  onWidthChange,
}: InspectViewProps): JSX.Element => {
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [tab, setTab] = useState<"html" | "text">("html");

  const template = templates.find((entry) => entry.id === selected?.id) ?? null;

  useEffect(() => {
    if (!selected || currentProps === null) return;
    const controller = new AbortController();
    fetch("/__render", {
      method: "POST",
      body: JSON.stringify({ id: selected.id, props: currentProps }),
      signal: controller.signal,
    })
      .then(async (response) => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => {
        if (ok) {
          setRendered(body as Rendered);
          setRenderError(null);
        } else {
          setRenderError((body as { error: string }).error);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [selected, currentProps]);

  const documentUrl = selected
    ? `/__document?id=${encodeURIComponent(selected.id)}&props=${encodeURIComponent(JSON.stringify(currentProps))}`
    : "#";
  const frameHtml = rendered ? prepareMailDocument(rendered.html, previewDark) : "";

  return (
    <Flex height="full" minHeight={0}>
      <Stack
        as="nav"
        width="260px"
        flexShrink={0}
        gap={4}
        padding={4}
        overflowY="auto"
        borderRightWidth="1px"
        borderColor="border"
        bg="bg.panel"
      >
        <Box>
          <Heading size="xs">LangWatch mail</Heading>
          <Text fontSize="2xs" color="fg.muted" marginTop={0.5}>
            {templates.length} messages
          </Text>
        </Box>
        {templates.map((entry) => {
          const isCurrent = entry.id === selected?.id;
          const firstFixture = entry.fixtures[0];
          return (
            <Box key={entry.id}>
              <HtmlButton
                type="button"
                width="full"
                textAlign="left"
                cursor="pointer"
                borderRadius="sm"
                paddingY={0.5}
                onClick={() => firstFixture && onSelect(entry.id, firstFixture.name)}
              >
                <Heading size="xs" color={isCurrent ? "orange.500" : "fg"}>
                  {entry.title}
                </Heading>
                <Text fontSize="2xs" color="fg.muted">
                  {entry.sentWhen}
                </Text>
              </HtmlButton>
              <HStack gap={1} flexWrap="wrap" marginTop={1.5}>
                {entry.fixtures.map((fixture) => {
                  const isFixtureCurrent = isCurrent && fixture.name === selected.fixture;
                  return (
                    <Button
                      key={fixture.name}
                      type="button"
                      size="2xs"
                      variant={isFixtureCurrent ? "solid" : "outline"}
                      colorPalette={isFixtureCurrent ? "orange" : "gray"}
                      borderRadius="full"
                      onClick={() => onSelect(entry.id, fixture.name)}
                    >
                      {fixture.name}
                    </Button>
                  );
                })}
              </HStack>
            </Box>
          );
        })}
      </Stack>

      <Stack flex="1" minWidth={0} gap={0}>
        <Stack
          as="header"
          gap={2}
          padding={4}
          borderBottomWidth="1px"
          borderColor="border"
          bg="bg.panel"
        >
          <Box>
            <Text fontSize="2xs" textTransform="uppercase" letterSpacing="wide" color="fg.muted">
              Subject
            </Text>
            <Heading size="sm">{rendered?.subject ?? "—"}</Heading>
          </Box>
          <HStack gap={3} flexWrap="wrap">
            <SegmentedControl
              size="xs"
              items={["html", "text"]}
              value={tab}
              onValueChange={(details) => setTab(details.value as "html" | "text")}
            />
            <SegmentedControl
              size="xs"
              items={["desktop", "mobile"]}
              value={width}
              onValueChange={(details) => onWidthChange(details.value as keyof typeof WIDTHS)}
            />
            <Button
              size="2xs"
              variant="outline"
              onClick={() => void navigator.clipboard.writeText(rendered?.html ?? "")}
            >
              Copy HTML
            </Button>
            <Button asChild size="2xs" variant="outline">
              <a href={documentUrl} target="_blank" rel="noreferrer">
                Open in new tab
              </a>
            </Button>
          </HStack>
        </Stack>
        {renderError && (
          <Box
            padding={3}
            bg="red.50"
            color="red.700"
            fontSize="xs"
            borderBottomWidth="1px"
            borderColor="red.200"
          >
            These props were rejected: {renderError}
          </Box>
        )}
        <Flex
          flex="1"
          overflow="auto"
          justify="center"
          padding={6}
          bg={previewDark ? "#14161a" : "bg.muted"}
        >
          {tab === "html" ? (
            <Box
              width={WIDTHS[width]}
              minHeight="640px"
              height="full"
              borderWidth="1px"
              borderColor={previewDark ? "#2a2e36" : "border"}
              borderRadius="md"
              bg={previewDark ? "#14161a" : "white"}
              overflow="hidden"
              shadow="xs"
            >
              <HtmlIframe
                title="Rendered email"
                srcDoc={frameHtml}
                width="full"
                height="full"
                border="none"
              />
            </Box>
          ) : (
            <Box
              as="pre"
              width={WIDTHS[width]}
              height="fit-content"
              whiteSpace="pre-wrap"
              fontFamily="mono"
              fontSize="xs"
              lineHeight="tall"
              padding={5}
              bg="bg.panel"
              borderWidth="1px"
              borderColor="border"
              borderRadius="md"
            >
              {rendered?.text ?? ""}
            </Box>
          )}
        </Flex>
      </Stack>

      <Stack
        as="aside"
        width="320px"
        flexShrink={0}
        gap={3}
        padding={4}
        overflowY="auto"
        borderLeftWidth="1px"
        borderColor="border"
        bg="bg.panel"
      >
        <Heading size="xs">Props</Heading>
        {template && (
          <PropsForm schema={template.formSchema} props={currentProps} onChange={onPropsChange} />
        )}
      </Stack>
    </Flex>
  );
};
