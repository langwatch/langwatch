import { Box, Grid, Heading, HStack, Stack, Table, Text } from "@chakra-ui/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";

import { CopyButton } from "../components/display/copy-button.tsx";
import { system } from "./create-system.ts";

/**
 * Every token the system defines, read from the live system rather than listed by
 * hand, so this page cannot drift from `config.ts` or invent a token.
 */
type TokenCategory = Parameters<typeof system.tokens.categoryMap.get>[0];
type Token = { value: unknown; extensions: { conditions?: Record<string, string> } };

function tokensIn({ category }: { category: TokenCategory }): [string, Token][] {
  return [...(system.tokens.categoryMap.get(category) ?? new Map())] as [string, Token][];
}

const colours = tokensIn({ category: "colors" });
const isSemantic = ([name, token]: [string, Token]) =>
  token.extensions.conditions !== undefined && !name.startsWith("colorPalette");
const isScaleStep = ([name]: [string, Token]) => /^[a-z]+(Alpha)?\.\d+$/.test(name);

/** `{colors.gray.600}` to the value it names, so a light or dark chip shows its real colour. */
function resolveColour({ reference, mode }: { reference: string; mode: "light" | "dark" }): string {
  return reference.replace(/\{colors\.([^}/]+)(?:\/(\d+))?\}/g, (whole, name: string, alpha) => {
    const token = colours.find(([candidate]) => candidate === name)?.[1];
    const value = token ? (referenceOf({ token, mode }) ?? token.value) : void 0;
    if (typeof value !== "string") return whole;
    const resolved = resolveColour({ reference: value, mode });
    return alpha ? `color-mix(in srgb, ${resolved} ${alpha}%, transparent)` : resolved;
  });
}

function TokenName({ name }: { name: string }) {
  return (
    <HStack gap={1}>
      <Text fontFamily="mono" fontSize="xs" color="fg">
        {name}
      </Text>
      <CopyButton value={name} label={`Copy ${name}`} />
    </HStack>
  );
}

const referenceOf = ({ token, mode }: { token: Token; mode: "light" | "dark" }) => {
  const conditions = token.extensions.conditions;
  return mode === "light" ? (conditions?._light ?? conditions?.base) : conditions?._dark;
};

const shortReference = (reference?: string) =>
  reference ? reference.replace(/[{}]/g, "").replace(/^colors\./, "") : "—";

/** Light on the left, dark on the right: both modes at a glance, whatever the toolbar says. */
function SplitSwatch({ token }: { token: Token }) {
  const half = (mode: "light" | "dark") => {
    const reference = referenceOf({ token, mode }) ?? referenceOf({ token, mode: "light" });
    return reference ? resolveColour({ reference, mode }) : "transparent";
  };
  return (
    <HStack
      gap={0}
      width={10}
      height={6}
      flexShrink={0}
      borderRadius="sm"
      borderWidth="1px"
      borderColor="border"
      overflow="hidden"
      aria-hidden
    >
      <Box flex={1} height="full" style={{ background: half("light") }} />
      <Box flex={1} height="full" style={{ background: half("dark") }} />
    </HStack>
  );
}

/** One row per colour: swatch, name to copy, then its light and dark values in aligned columns. */
function ColourRow({ name, token }: { name: string; token: Token }) {
  return (
    <Grid
      templateColumns={ROW_COLUMNS}
      gap={3}
      alignItems="center"
      paddingY={1}
      borderBottomWidth="1px"
      borderColor="border.muted"
    >
      <SplitSwatch token={token} />
      <TokenName name={name} />
      {(["light", "dark"] as const).map((mode) => (
        <Text key={mode} fontSize="2xs" fontFamily="mono" color="fg.muted" truncate>
          {shortReference(referenceOf({ token, mode }))}
        </Text>
      ))}
    </Grid>
  );
}

const ROW_COLUMNS = "2.5rem minmax(8rem, 1.2fr) 1fr 1fr";

/** Column headings over each block; the swatch's left half is light, its right half dark. */
function ColourHeadings() {
  return (
    <Grid templateColumns={ROW_COLUMNS} gap={3} paddingY={1} borderBottomWidth="1px">
      {["Light | dark", "Token", "Light", "Dark"].map((heading) => (
        <Text key={heading} fontSize="2xs" color="fg.muted" fontWeight="medium">
          {heading}
        </Text>
      ))}
    </Grid>
  );
}

function ColourRows({ entries }: { entries: [string, Token][] }) {
  return (
    <Grid templateColumns="repeat(auto-fill, minmax(26rem, 1fr))" columnGap={8}>
      <ColourHeadings />
      {entries.map(([name, token]) => (
        <ColourRow key={name} name={name} token={token} />
      ))}
    </Grid>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <Stack gap={2}>
      <HStack gap={2} align="baseline">
        <Heading size="sm">{title}</Heading>
        {note ? (
          <Text textStyle="xs" color="fg.muted">
            {note}
          </Text>
        ) : null}
      </HStack>
      {children}
    </Stack>
  );
}

const SEMANTIC_GROUPS: { title: string; note: string; matches: (name: string) => boolean }[] = [
  {
    title: "Foreground",
    note: "Text and icons.",
    matches: (n) => n === "fg" || n.startsWith("fg."),
  },
  {
    title: "Background",
    note: "Four nested levels: bg.page, bg.panel, bg.muted, bg.emphasized.",
    matches: (n) => n === "bg" || n.startsWith("bg."),
  },
  {
    title: "Border",
    note: "Hairlines and outlines; border.strong distinguishes controls from their ground.",
    matches: (n) => n === "border" || n.startsWith("border."),
  },
  {
    title: "Accent",
    note: 'The brand orange; `colorPalette="accent"` follows it.',
    matches: (n) => n.startsWith("accent."),
  },
  { title: "Status", note: "A state, never decoration.", matches: (n) => n.startsWith("status.") },
  {
    title: "Chart series",
    note: "In order, for categorical series.",
    matches: (n) => n.startsWith("chart."),
  },
  {
    title: "Navigation, labels and logo",
    note: "Chrome and the mark.",
    matches: (n) => /^(nav|label|logo)\./.test(n),
  },
  {
    title: "Palette roles",
    note: "`<palette>.<role>`: solid, contrast, fg, muted, subtle, emphasized, focusRing.",
    matches: (n) =>
      /^[a-z]+\.(solid|contrast|fg|muted|subtle|emphasized|focusRing|surface)$/.test(n),
  },
];

function SemanticColours() {
  const semantic = colours.filter(isSemantic);
  const placed = new Set<string>();
  return (
    <Stack gap={6}>
      {SEMANTIC_GROUPS.map(({ title, note, matches }) => {
        const group = semantic.filter(([name]) => !placed.has(name) && matches(name));
        group.forEach(([name]) => placed.add(name));
        return (
          <Section key={title} title={title} note={note}>
            <ColourRows entries={group} />
          </Section>
        );
      })}
      <Section title="Everything else" note="Semantic colours outside the groups above.">
        <ColourRows entries={semantic.filter(([name]) => !placed.has(name))} />
      </Section>
    </Stack>
  );
}

function PaletteScale() {
  const families = new Map<string, [string, Token][]>();
  for (const entry of colours.filter(isScaleStep)) {
    const family = entry[0].split(".")[0] ?? "";
    families.set(family, [...(families.get(family) ?? []), entry]);
  }
  return (
    <Section
      title="Palette scale"
      note="The raw steps semantic tokens are made of. Only this package names a step; feature code names the semantic token."
    >
      <Stack gap={2}>
        {[...families].map(([family, steps]) => (
          <HStack key={family} gap={0} align="stretch">
            <Text width={28} fontFamily="mono" fontSize="xs" flexShrink={0} alignSelf="center">
              {family}
            </Text>
            {steps.map(([name, token]) => (
              <Box
                key={name}
                flex={1}
                height={8}
                title={`${name} ${String(token.value)}`}
                style={{ background: String(token.value) }}
              />
            ))}
          </HStack>
        ))}
      </Stack>
    </Section>
  );
}

/** One row per token: its name to copy, its value, and a sample drawn with it. */
function TokenTable({
  category,
  sample,
}: {
  category: TokenCategory;
  sample: (name: string) => ReactNode;
}) {
  return (
    <Table.Root size="sm" variant="line">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Token</Table.ColumnHeader>
          <Table.ColumnHeader>Value</Table.ColumnHeader>
          <Table.ColumnHeader>Sample</Table.ColumnHeader>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {tokensIn({ category }).map(([name, token]) => {
          const conditions = token.extensions.conditions;
          const value = conditions
            ? Object.entries(conditions)
                .map(([condition, v]) => `${condition.replace(/^_/, "")}: ${v}`)
                .join(" / ")
            : String(token.value);
          return (
            <Table.Row key={name}>
              <Table.Cell>
                <TokenName name={name} />
              </Table.Cell>
              <Table.Cell>
                <Text
                  fontFamily="mono"
                  fontSize="xs"
                  color="fg.muted"
                  maxWidth="28rem"
                  lineClamp={2}
                >
                  {value}
                </Text>
              </Table.Cell>
              <Table.Cell>{sample(name)}</Table.Cell>
            </Table.Row>
          );
        })}
      </Table.Body>
    </Table.Root>
  );
}

const meta = {
  title: "Foundations/Tokens",
  parameters: {
    usage: {
      use: 'Every value a screen needs has a token here: name it (`gap={4}`, `borderRadius="md"`, `boxShadow="md"`, `color="fg.muted"`).',
      avoid:
        "Pixel values, hex, rgb() or a palette step at the call site. A missing value is a new semantic token in `src/system/config.ts`, not a literal.",
    },
    docs: {
      description: {
        component:
          "Every token group in one place, read from the live system. Switch the toolbar between Light and Dark to see each colour in both modes; each swatch also lists its light and dark values.",
      },
    },
  },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Colour: Story = { render: () => <SemanticColours /> };

export const Palette: Story = { render: () => <PaletteScale /> };

export const Spacing: Story = {
  render: () => (
    <TokenTable
      category="spacing"
      sample={(name) => <Box height={2} bg="accent.solid" borderRadius="xs" width={name} />}
    />
  ),
};

export const Radii: Story = {
  render: () => (
    <TokenTable
      category="radii"
      sample={(name) => <Box boxSize={10} bg="bg.emphasized" borderRadius={name} />}
    />
  ),
};

/** Elevation: the higher the shadow, the further the surface floats. */
export const Shadows: Story = {
  render: () => (
    <TokenTable
      category="shadows"
      sample={(name) => <Box boxSize={10} bg="bg.panel" borderRadius="md" boxShadow={name} />}
    />
  ),
};

/** Stacking order. Overlays opened inside overlays add depth on top: see Overlay depth. */
export const ZIndex: Story = {
  name: "Z index",
  render: () => <TokenTable category="zIndex" sample={() => null} />,
};

export const Durations: Story = {
  render: () => (
    <TokenTable
      category="durations"
      sample={(name) => (
        <Box
          boxSize={6}
          bg="accent.solid"
          borderRadius="sm"
          transitionProperty="transform"
          transitionDuration={name}
          _hover={{ transform: "translateX(2.5rem)" }}
        />
      )}
    />
  ),
};

export const Easings: Story = {
  render: () => (
    <TokenTable
      category="easings"
      sample={(name) => (
        <Box
          boxSize={6}
          bg="accent.solid"
          borderRadius="sm"
          transitionProperty="transform"
          transitionDuration="slow"
          transitionTimingFunction={name}
          _hover={{ transform: "translateX(2.5rem)" }}
        />
      )}
    />
  ),
};

export const Breakpoints: Story = {
  render: () => <TokenTable category="breakpoints" sample={() => null} />,
};

export const FontSizes: Story = {
  render: () => (
    <TokenTable category="fontSizes" sample={(name) => <Text fontSize={name}>Traces</Text>} />
  ),
};

export const FontWeights: Story = {
  render: () => (
    <TokenTable category="fontWeights" sample={(name) => <Text fontWeight={name}>Traces</Text>} />
  ),
};

export const LineHeights: Story = {
  render: () => (
    <TokenTable
      category="lineHeights"
      sample={(name) => (
        <Text lineHeight={name} maxWidth="12rem" fontSize="xs">
          Two lines of copy show the leading between them.
        </Text>
      )}
    />
  ),
};

export const Borders: Story = {
  render: () => (
    <TokenTable
      category="borders"
      sample={(name) => <Box boxSize={8} border={name} borderColor="border.emphasized" />}
    />
  ),
};

/** The ring a focused control draws; every palette has its own `focusRing` colour. */
export const FocusRing: Story = {
  name: "Focus ring",
  render: () => (
    <HStack gap={3} wrap="wrap">
      {["accent", "gray", "red", "blue"].map((palette) => (
        <Box
          key={palette}
          paddingX={3}
          paddingY={1.5}
          borderRadius="md"
          borderWidth="1px"
          borderColor="border"
          outlineWidth="2px"
          outlineStyle="solid"
          outlineOffset="2px"
          outlineColor={`${palette}.focusRing`}
        >
          <Text fontFamily="mono" fontSize="xs">
            {palette}.focusRing
          </Text>
        </Box>
      ))}
    </HStack>
  ),
};
