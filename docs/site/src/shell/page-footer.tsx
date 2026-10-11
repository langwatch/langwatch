import { Box, Button, Flex, Link, Text } from "@langwatch/design-system/primitives";
import { ArrowLeft, ArrowRight, ThumbsUp, ThumbsDown } from "lucide-react";
import { useEffect, useState } from "react";

import { site } from "../lib/nav-model.ts";
import { readPreference, writePreference } from "../lib/storage.ts";

type Neighbour = { slug: string; title: string } | undefined;

function Feedback({ slug }: { slug: string }) {
  const [vote, setVote] = useState<"yes" | "no" | null>(null);
  useEffect(() => {
    const stored = readPreference({ key: `helpful:${slug}` });
    if (stored === "yes" || stored === "no") setVote(stored);
  }, [slug]);
  const choose = ({ value }: { value: "yes" | "no" }) => {
    setVote(value);
    writePreference({ key: `helpful:${slug}`, value });
  };
  return (
    <Flex alignItems="center" gap="3" wrap="wrap">
      <Text as="span" fontSize="14px" lineHeight="20px" margin="0">
        Was this helpful?
      </Text>
      {(["yes", "no"] satisfies ("yes" | "no")[]).map((value) => (
        <Button
          key={value}
          type="button"
          size="sm"
          minHeight={{ base: "44px", md: "32px" }}
          variant="ghost"
          colorPalette="gray"
          aria-label={value === "yes" ? "Helpful" : "Not helpful"}
          aria-pressed={vote === value}
          bg={vote === value ? "bg.selected" : undefined}
          onClick={() => choose({ value })}
        >
          {value === "yes" ? <ThumbsUp size={16} /> : <ThumbsDown size={16} />}
        </Button>
      ))}
      <output aria-live="polite">
        {vote === "yes" ? (
          <Text as="span" fontSize="13px" color="fg.muted">
            Marked helpful on this device.
          </Text>
        ) : null}
        {vote === "no" ? (
          <Link
            href="/support"
            fontSize="13px"
            color="blue.fg"
            textDecoration="underline"
            textUnderlineOffset="2px"
          >
            Tell us what was missing
          </Link>
        ) : null}
      </output>
    </Flex>
  );
}

function NeighbourCard({
  target,
  direction,
}: {
  target: Neighbour;
  direction: "previous" | "next";
}) {
  if (!target) return <Box display={{ base: "none", md: "block" }} />;
  const next = direction === "next";
  return (
    <Link
      href={`/${target.slug}`}
      display="flex"
      flexDirection="column"
      gap="1"
      padding="4"
      minWidth="0"
      textAlign={next ? "end" : "start"}
      alignItems={next ? "flex-end" : "flex-start"}
      borderWidth="1px"
      borderColor="border"
      borderRadius="showcase"
      textDecoration="none"
      color="fg"
      _hover={{ borderColor: "border.emphasized", textDecoration: "none" }}
    >
      <Text as="span" fontSize="12px" lineHeight="20px" color="fg.muted">
        {next ? "Next" : "Previous"}
      </Text>
      <Flex
        alignItems="center"
        gap="2"
        fontSize="16px"
        lineHeight="24px"
        fontWeight="600"
        flexDirection={next ? "row-reverse" : "row"}
      >
        {next ? (
          <ArrowRight size={16} aria-hidden="true" />
        ) : (
          <ArrowLeft size={16} aria-hidden="true" />
        )}
        <span>{target.title}</span>
      </Flex>
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
  return (
    <Box as="footer" marginTop="12" paddingTop="6" borderTopWidth="1px" borderColor="border.muted">
      <Feedback slug={slug} />
      <Box
        display="grid"
        gridTemplateColumns={{ base: "minmax(0, 1fr)", md: "repeat(2, minmax(0, 1fr))" }}
        gap="4"
        marginTop="6"
      >
        <NeighbourCard target={previous} direction="previous" />
        <NeighbourCard target={next} direction="next" />
      </Box>
      <Flex gap="4" marginTop="6" wrap="wrap" fontSize="12px" lineHeight="20px" color="fg.muted">
        <Link href={`${site.github}/edit/main/docs/${slug}.mdx`} color="fg.muted">
          Edit this page on GitHub
        </Link>
        <Link href={site.llms} color="fg.muted">
          llms.txt
        </Link>
      </Flex>
    </Box>
  );
}
