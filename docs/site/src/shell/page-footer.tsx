import { Box, Flex, Link, Text } from "@langwatch/design-system/primitives";
import { ArrowLeft, ArrowRight, PencilLine, MessageSquareWarning } from "lucide-react";

import { site } from "../lib/nav-model.ts";

type Neighbour = { slug: string; title: string } | undefined;

function NeighbourLink({
  target,
  direction,
}: {
  target: Neighbour;
  direction: "previous" | "next";
}) {
  if (!target) return <Box />;
  const next = direction === "next";
  return (
    <Link
      href={`/${target.slug}`}
      display="flex"
      flexDirection="column"
      alignItems={next ? "flex-end" : "flex-start"}
      textAlign={next ? "end" : "start"}
      gap="2"
      minWidth="0"
      paddingY="5"
      textDecoration="none"
      color="fg"
      _hover={{ color: "accent.fg", textDecoration: "none" }}
    >
      <Flex alignItems="center" gap="2" fontSize="13px" color="docs.lede">
        {next ? null : <ArrowLeft size={14} aria-hidden="true" />}
        {next ? "Up next" : "Previous"}
        {next ? <ArrowRight size={14} aria-hidden="true" /> : null}
      </Flex>
      <Text as="span" fontSize="16px" lineHeight="26px" fontWeight="600">
        {target.title}
      </Text>
    </Link>
  );
}

export function PageFooter({
  slug,
  previous,
  next,
}: {
  slug: string;
  previous: Neighbour;
  next: Neighbour;
}) {
  const issue = `${site.github}/issues/new?${new URLSearchParams({
    title: `Docs: ${slug}`,
    labels: "documentation",
    body: `Page: https://docs.langwatch.ai/${slug}\n\nWhat is outdated or broken?\n\nExpected behavior or suggested correction:\n`,
  })}`;
  return (
    <Box marginTop="14" borderTopWidth="1px" borderColor="border">
      <Box
        as="nav"
        aria-label="Previous and next pages"
        display="grid"
        gridTemplateColumns="repeat(2, minmax(0, 1fr))"
        gap="8"
      >
        <NeighbourLink target={previous} direction="previous" />
        <NeighbourLink target={next} direction="next" />
      </Box>
      <Flex
        borderTopWidth="1px"
        borderColor="border.muted"
        paddingTop="5"
        gap="4"
        justifyContent="space-between"
        wrap="wrap"
        fontSize="13px"
      >
        <Text margin="0" color="docs.lede">
          Help make these docs better.
        </Text>
        <Flex gap="4" wrap="wrap">
          <Link href={issue} color="docs.body" gap="2">
            <MessageSquareWarning size={14} aria-hidden="true" /> Report outdated or broken docs
          </Link>
          <Link href={`${site.github}/edit/main/docs/${slug}.mdx`} color="docs.body" gap="2">
            <PencilLine size={14} aria-hidden="true" /> Edit this page
          </Link>
        </Flex>
      </Flex>
      <Text fontSize="12px" color="docs.body" marginTop="3">
        Agents: include the page URL, what failed and a proposed correction in a docs issue.
      </Text>
    </Box>
  );
}
