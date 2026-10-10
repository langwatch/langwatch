import { defineSlotRecipe } from "@chakra-ui/react";

export const segmentGroupSlotRecipe = defineSlotRecipe({
  slots: ["root", "item", "itemText", "indicator"],
  base: {
    root: {
      padding: "2px",
      borderWidth: "0",
      borderRadius: "lg",
      background: "bg.subtle",
      boxShadow: "none",
      flexShrink: 0,
      "--segment-radius": "radii.md",
    },
    item: {
      color: "fg.muted",
      whiteSpace: "nowrap",
      flexShrink: 0,
      _checked: { color: "fg" },
      _before: { display: "none" },
      "&[data-state=checked][data-ssr]": { background: "bg.panel", boxShadow: "xs" },
    },
    indicator: { background: "bg.panel", borderWidth: "0", boxShadow: "xs" },
  },
  variants: {
    size: {
      sm: {
        item: { height: "28px", paddingInline: "10px", gap: 1.5 },
        itemText: { fontSize: "12.5px", fontWeight: "medium" },
      },
    },
  },
});
