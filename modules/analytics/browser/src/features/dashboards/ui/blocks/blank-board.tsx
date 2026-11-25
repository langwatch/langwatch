/**
 * What every empty board shows under its ask bar and suggested questions: "Or start from a
 * template" with the From LangWatch boards, each card making the member's own board from it, then
 * a card into the full library. The footer "Add a widget" stays only below a board's widgets.
 */

import {
  Box,
  Button,
  chakra,
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
      <Text textStyle="body" fontWeight="medium">
        Add a widget
      </Text>
      <Text textStyle="bodySm" color="fg.subtle">
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
      _hover={{ boxShadow: "sm", textDecoration: "none" }}
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

/** A template card that makes a board when pressed; a button role, as it holds a heading. */
function CardButton({
  label,
  isBusy,
  onPress,
  children,
}: {
  label: string;
  isBusy: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <chakra.button
      type="button"
      aria-label={label}
      aria-busy={isBusy}
      display="flex"
      alignItems="stretch"
      minWidth={0}
      borderRadius="xl"
      cursor={isBusy ? "progress" : "pointer"}
      opacity={isBusy ? 0.6 : 1}
      transition="box-shadow 0.15s"
      _hover={{ boxShadow: "sm" }}
      outline="none"
      _focusVisible={{ boxShadow: "0 0 0 2px var(--chakra-colors-color-palette-solid)" }}
      background="none"
      border="none"
      padding={0}
      margin={0}
      font="inherit"
      color="inherit"
      textAlign="left"
      onClick={onPress}
    >
      {children}
    </chakra.button>
  );
}

export function EmptyBoard({
  boards,
  creatingId,
  onUse,
  templatesHref,
}: {
  boards: readonly CuratedBoard[];
  /** The template a board is being made from, while one is. */
  creatingId: string | undefined;
  /** Makes the member's own board from the template and opens it. */
  onUse: (board: CuratedBoard) => void;
  templatesHref: string;
}) {
  return (
    <VStack as="section" aria-label="Start from a template" align="stretch" gap={5}>
      <Heading as="h2" textStyle="cardTitle">
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
          <CardButton
            key={board.templateId}
            label={`Use ${board.name}`}
            isBusy={creatingId === board.card.board.id}
            onPress={() => onUse(board)}
          >
            <TemplateCard template={board.card} />
          </CardButton>
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
            <Text textStyle="body" fontWeight="medium">
              View all templates
            </Text>
            <Text textStyle="bodySm">Find a dashboard by the question it answers.</Text>
          </VStack>
        </CardLink>
      </Grid>
    </VStack>
  );
}
