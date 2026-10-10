import { defineRecipe } from "@chakra-ui/react";

export const optionItemRecipe = defineRecipe({
  base: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    width: "full",
    minHeight: "8",
    height: "auto",
    paddingX: "2",
    paddingY: "1",
    marginX: "0",
    gap: "2",
    borderRadius: "sm",
    color: "fg",
    background: "transparent",
    fontSize: "sm",
    fontWeight: "normal",
    textAlign: "start",
    cursor: "pointer",
    _hover: { background: "bg.softHover" },
    _highlighted: { background: "bg.softHover", color: "fg" },
    _selected: { background: "bg.emphasized" },
    _pressed: { background: "bg.emphasized" },
    _focusVisible: {
      outline: "2px solid",
      outlineColor: "border.emphasized",
      outlineOffset: "-2px",
    },
    _disabled: { opacity: 0.5, cursor: "not-allowed" },
  },
});

export const optionListContent = {
  background: "bg.panel",
  color: "fg",
  padding: "1",
  border: "1px solid",
  borderColor: "border",
  borderRadius: "lg",
  boxShadow: "lg",
} as const;

const optionSize = { content: optionListContent, item: optionItemRecipe.base };
export const optionListSizes = { xs: optionSize, sm: optionSize, md: optionSize, lg: optionSize };
