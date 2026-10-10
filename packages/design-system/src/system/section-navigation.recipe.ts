import { defineRecipe } from "@chakra-ui/react";

const mix = (token: string, alpha: string) =>
  `color-mix(in srgb, var(--chakra-colors-${token}) ${alpha}, transparent)`;

// A tiled background keeps grain behind the links, including their opaque selected fill.
const grain = (opacity: number) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="${opacity}"/></feComponentTransfer></filter><path filter="url(#grain)" d="M0 0h128v128H0z"/></svg>`)}")`;

export const sectionNavigationRailRecipe = defineRecipe({
  base: {
    backgroundColor: "bg.page",
    backgroundImage: "none",
    borderColor: "border",
    boxShadow: "none",
    backdropFilter: "none",
    _dark: {
      backdropFilter: "var(--lw-backdrop-blur, blur(24px) saturate(1.45))",
      backgroundColor: mix("bg-rail", "var(--lw-panel-alpha, 70%)"),
      backgroundImage: `${grain(0.035)}, linear-gradient(180deg, ${mix("fg", "4%")}, ${mix("fg", "1%")})`,
      borderColor: "border",
      boxShadow: `inset 1px 1px 0 ${mix("fg", "6%")}`,
    },
  },
});
