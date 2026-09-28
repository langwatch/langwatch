/**
 * A restrained hairline in the status colour, mixed into the neutral border
 * rather than drawn on top — same formula as the Langy card's `accentBorder`
 * (`features/asaplangy/tokens.ts`), for a tone without a coloured ring.
 */
export const statusHairline = (color: string) =>
  `color-mix(in srgb, var(--chakra-colors-${color}) 26%, var(--chakra-colors-border-muted))`;
