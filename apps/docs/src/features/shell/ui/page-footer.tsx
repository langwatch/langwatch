import { Box, Flex, Link, Text } from "@langwatch/design-system/primitives";
import { ArrowLeft, ArrowRight, MessageSquareWarning, PencilLine } from "lucide-react";
import type { ReactNode } from "react";

import { canonicalUrl, pagePath } from "../../../lib/site-path.ts";
import { trailOf } from "../../navigation/model/nav.ts";
import { sectionOf, site } from "../../navigation/ui/site-nav.ts";

type Neighbour = { slug: string; title: string } | undefined;

/** The nearest group a page sits in, falling back to its section title. */
function groupOf({ slug }: { slug: string }): string | undefined {
  const section = sectionOf({ slug });
  if (!section) return undefined;
  return trailOf({ items: section.children, slug })?.at(-1) ?? section.title;
}

const motion = {
  "@media (prefers-reduced-motion: no-preference)": {
    transition: "border-color 160ms ease, color 160ms ease, box-shadow 160ms ease",
    "& .docs-page-footer-arrow": { transition: "transform 160ms ease, color 160ms ease" },
  },
};

function NeighbourCard({
  target,
  direction,
}: {
  target: NonNullable<Neighbour>;
  direction: "previous" | "next";
}) {
  const next = direction === "next";
  const group = groupOf({ slug: target.slug });
  const Arrow = next ? ArrowRight : ArrowLeft;
  return (
    <Link
      href={pagePath({ slug: target.slug })}
      rel={next ? "next" : "prev"}
      gridColumn={{ base: "1", sm: next ? "2" : "1" }}
      display="flex"
      flexDirection={next ? "row-reverse" : "row"}
      alignItems="center"
      gap="4"
      minWidth="0"
      paddingX="5"
      paddingY="4"
      borderWidth="1px"
      borderColor="accent.muted"
      borderRadius="xl"
      bg="accent.subtle"
      color="fg"
      textDecoration="none"
      boxShadow="0 1px 2px {colors.docs.shadow}"
      _hover={{
        textDecoration: "none",
        borderColor: "accent.fg",
        boxShadow: "0 6px 18px -8px {colors.docs.shadowStrong}",
        "& .docs-page-footer-arrow": {
          color: "accent.fg",
          transform: next ? "translateX(3px)" : "translateX(-3px)",
        },
      }}
      css={motion}
    >
      <Box className="docs-page-footer-arrow" flexShrink="0" color="accent.fg" display="flex">
        <Arrow size={18} aria-hidden="true" />
      </Box>
      <Flex
        direction="column"
        gap="1"
        minWidth="0"
        flex="1"
        alignItems={next ? "flex-end" : "flex-start"}
        textAlign={next ? "end" : "start"}
      >
        <Text
          as="span"
          fontSize="12px"
          lineHeight="18px"
          color="docs.lede"
          truncate
          maxWidth="100%"
        >
          {next ? "Next" : "Previous"}
          {group ? (
            <Text as="span" color="docs.contents">
              {" · "}
              {group}
            </Text>
          ) : null}
        </Text>
        <Text as="span" fontSize="17px" lineHeight="24px" fontWeight="600" lineClamp="2">
          {target.title}
        </Text>
      </Flex>
    </Link>
  );
}

function FeedbackAction({
  href,
  icon,
  children,
}: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      display="inline-flex"
      alignItems="center"
      justifyContent="center"
      gap="2"
      minHeight="9"
      paddingX="3.5"
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      bg="accent.subtle"
      color="accent.fg"
      fontSize="13px"
      fontWeight="500"
      whiteSpace="nowrap"
      textDecoration="none"
      _hover={{ textDecoration: "none", color: "fg", borderColor: "border.emphasized" }}
      css={motion}
    >
      {icon}
      {children}
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
    body: `Page: ${canonicalUrl({ slug })}\n\nWhat is outdated or broken?\n\nExpected behavior or suggested correction:\n`,
  })}`;
  return (
    <Box className="docs-page-footer" marginTop={{ base: "12", lg: "16" }}>
      {previous || next ? (
        <Box
          as="nav"
          aria-label="Previous and next pages"
          display="grid"
          gridTemplateColumns={{ base: "minmax(0, 1fr)", sm: "repeat(2, minmax(0, 1fr))" }}
          gap="3"
        >
          {previous ? <NeighbourCard target={previous} direction="previous" /> : null}
          {next ? <NeighbourCard target={next} direction="next" /> : null}
        </Box>
      ) : null}
      <Flex
        as="aside"
        aria-label="Page feedback"
        marginTop="6"
        paddingX={{ base: "4", md: "5" }}
        paddingY="4"
        borderRadius="xl"
        borderWidth="1px"
        borderColor="border.emphasized"
        bg="docs.raised"
        direction={{ base: "column", md: "row" }}
        alignItems={{ base: "stretch", md: "center" }}
        justifyContent="space-between"
        gap={{ base: "4", md: "6" }}
      >
        <Box minWidth="0">
          <Text margin="0" fontSize="14px" lineHeight="22px" fontWeight="600" color="fg">
            Something wrong or out of date?
          </Text>
          <Text margin="0" marginTop="0.5" fontSize="13px" lineHeight="20px" color="docs.lede">
            Help improve this page. Report an issue or suggest an edit.
          </Text>
        </Box>
        <Flex gap="2" flexShrink="0" wrap="wrap">
          <FeedbackAction href={issue} icon={<MessageSquareWarning size={15} aria-hidden="true" />}>
            Report a problem
          </FeedbackAction>
          <FeedbackAction
            href={`${site.github}/edit/main/docs/${slug}.mdx`}
            icon={<PencilLine size={15} aria-hidden="true" />}
          >
            Edit this page
          </FeedbackAction>
        </Flex>
      </Flex>
    </Box>
  );
}
