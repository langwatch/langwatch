/**
 * What every empty board shows under its ask bar and suggested questions: "Or start from a
 * template" with the From LangWatch boards, each card opening its live board, then a card into
 * the full library. The footer "Add a widget" stays only below a board's widgets.
 */

import {
  Box,
  Button,
  Grid,
  Heading,
  Link as ChakraLink,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { LayoutTemplate, Plus } from "lucide-react";
import type { ReactNode } from "react";

import { useAnalyticsHost } from "../../../../model/analytics-host.ts";
import { opensElsewhere } from "../../../../ui/elements/analytics-link.tsx";
import type { CuratedBoard } from "../../model/curated-boards.ts";
import { TemplateCard } from "./template-card.tsx";

/** The compact footer below a board's widgets, opening "Add a widget". */
export function AddBlockCard({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="plain"
      height="auto"
      width="full"
      flexDirection="column"
      gap={2}
      paddingX={6}
      paddingY={8}
      lineHeight="1.45"
      borderWidth="1px"
      borderStyle="dashed"
      borderColor="border.emphasized"
      borderRadius="2xl"
      color="fg.subtle"
      fontWeight="normal"
      whiteSpace="normal"
      _hover={{ borderColor: "fg.subtle", color: "fg" }}
      onClick={onClick}
    >
      <Box
        display="flex"
        alignItems="center"
        justifyContent="center"
        boxSize={10}
        borderRadius="full"
        background="bg.muted"
      >
        <Plus size={18} aria-hidden />
      </Box>
      <Text fontSize="14px" fontWeight="medium">
        Add a widget
      </Text>
      <Text fontSize="12.5px" color="fg.subtle">
        Start from the question you need answered.
      </Text>
    </Button>
  );
}

/** A real link, so a modified click still opens it in a new tab. */
function CardLink({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  const host = useAnalyticsHost();
  return (
    <ChakraLink
      href={href}
      aria-label={label}
      display="flex"
      alignItems="stretch"
      minWidth={0}
      borderRadius="xl"
      textDecoration="none"
      color="inherit"
      transition="box-shadow 0.15s"
      _hover={{ boxShadow: "0 2px 10px rgb(16 16 32 / 0.08)", textDecoration: "none" }}
      onClick={(event) => {
        if (opensElsewhere(event)) return;
        event.preventDefault();
        host.navigate(href);
      }}
    >
      {children}
    </ChakraLink>
  );
}

export function EmptyBoard({
  boards,
  boardHref,
  templatesHref,
}: {
  boards: readonly CuratedBoard[];
  boardHref: (board: CuratedBoard) => string;
  templatesHref: string;
}) {
  return (
    <VStack as="section" aria-label="Start from a template" align="stretch" gap={5}>
      <Heading as="h2" fontSize="14px" fontWeight="semibold">
        Or start from a template
      </Heading>
      <Grid
        templateColumns={{
          base: "minmax(0, 1fr)",
          sm: "repeat(2, minmax(0, 1fr))",
          xl: "repeat(4, minmax(0, 1fr))",
        }}
        gap={4}
      >
        {boards.map((board) => (
          <CardLink key={board.templateId} href={boardHref(board)} label={board.name}>
            <TemplateCard template={board.card} />
          </CardLink>
        ))}
        <CardLink href={templatesHref} label="View all templates">
          <VStack
            justify="center"
            gap={2}
            width="full"
            padding={5}
            textAlign="center"
            color="fg.muted"
            borderWidth="1px"
            borderStyle="dashed"
            borderColor="border.emphasized"
            borderRadius="xl"
            _hover={{ color: "fg" }}
          >
            <Box
              display="flex"
              alignItems="center"
              justifyContent="center"
              boxSize={10}
              borderRadius="full"
              background="bg.muted"
            >
              <LayoutTemplate size={18} aria-hidden />
            </Box>
            <Text fontSize="14px" fontWeight="medium">
              View all templates
            </Text>
            <Text fontSize="12.5px">Find a dashboard by the question it answers.</Text>
          </VStack>
        </CardLink>
      </Grid>
    </VStack>
  );
}
