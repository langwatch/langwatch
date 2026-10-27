# The product type scale

Text in the application is sized by meaning, never by pixel. The design system
defines one named text style per role (`packages/design-system/src/system/text-styles.ts`);
module browser code sets `textStyle`, and `langwatch/no-raw-font-size` refuses a
`fontSize` or `textStyle` written as px, em, rem or a bare number.

## The styles

Sizes: 11, 12, 13, 14, 16, 18, 20 px. Weights: 400, 500, 600, nothing else.

| `textStyle`        | Size / line | Weight | Use it for                                                  |
| ------------------ | ----------- | ------ | ----------------------------------------------------------- |
| `pageTitle`        | 20 / 28     | 600    | A large display title outside PageLayout (a welcome header) |
| `pageTitleCompact` | 16 / 24     | 500    | Every page title (PageLayout sets it; never set it again)   |
| `sectionTitle`     | 16 / 24     | 600    | A section heading in a page, drawer or dialog title         |
| `cardTitle`        | 14 / 20     | 600    | A card's or panel's title                                   |
| `metric`           | 18 / 24     | 600    | A headline number (tabular figures)                         |
| `body`             | 14 / 20     | -      | Running text, paragraphs, default table cells               |
| `bodySm`           | 13 / 20     | -      | Dense UI text: list rows, menus, card descriptions, inputs  |
| `label`            | 13 / 20     | 500    | A field label, a row's name, an emphasised dense line       |
| `caption`          | 12 / 16     | -      | Metadata: timestamps, counts, hints under a line            |
| `groupLabel`       | 12 / 16     | 500    | Sentence-case label over a group (navigation, menus)        |
| `eyebrow`          | 11 / 16     | 500    | Uppercase label over a group or value, tracked 0.05em       |
| `micro`            | 11 / 16     | -      | Badges, counters, keyboard hints, chart ticks               |
| `mono`             | 13 / 20     | -      | Ids, code and durations inline with `bodySm` text           |
| `monoSm`           | 12 / 16     | -      | Ids, code and durations in captions and table metadata      |

"-" means the style sets no weight: the element's own weight (400, or a
recipe's, such as a button's 600) survives. Add `fontWeight="medium"` or
`"semibold"` when a line needs it; explicit props always win over the style.

Primitives in `@langwatch/design-system/typography`: `SectionTitle` (h2),
`CardTitle` (h3), `Eyebrow` (sentence case; `uppercase` for the eyebrow cut),
`MetaText` (caption, muted; `mono` for ids). Prefer them to a bare `Text` with
the same style.

## Mono is for machine text only

`mono` / `monoSm` (or `IdText`, `InlineCode`) only for: ids and keys, code and
expressions, durations and timestamps in tables, versions and hashes. Never for
emphasis, headings, names a person typed, or numbers in prose (`metric` and the
default face already use tabular figures where it matters). `fontFamily="mono"`
plus a px size becomes the single `textStyle="mono"` or `"monoSm"`.

## Mapping: old value to new style

Read the old size, then the weight and casing beside it, and take the first row
that matches. Drop `fontSize`, `lineHeight` (unless a fixed-height box needs it),
`letterSpacing` and `textTransform` once the style sets them.

| Old size                                | With                                 | New                                                            |
| --------------------------------------- | ------------------------------------ | -------------------------------------------------------------- |
| 22, 24, 26, 27, 30, 36px                | a number or figure                   | `metric` (or `Heading size="2xl"` for display copy)            |
| 22, 24, 26, 27, 30, 36, 65px            | an emoji or icon glyph               | not text: size the icon (`boxSize`), or `fontSize="2xl"` token |
| 18, 20px                                | a page's title                       | delete it: `PageLayout.Heading` owns it                        |
| 18, 20px                                | any other title                      | `sectionTitle`                                                 |
| 18px                                    | a number                             | `metric`                                                       |
| 15, 16px                                | semibold / 600 / bold                | `sectionTitle`                                                 |
| 15, 16px                                | regular                              | `body` (an input's text: `fontSize="md"` token)                |
| 14, 14.5px                              | semibold / 600 / 640 / bold          | `cardTitle`                                                    |
| 14, 14.5px                              | medium / 500                         | `body` + `fontWeight="medium"`                                 |
| 14, 14.5px, `1rem`-ish                  | regular                              | `body`                                                         |
| 13, 13.5, 12.5px, `0.875rem`            | semibold / 600 / 640 / bold, a title | `cardTitle`                                                    |
| 13, 13.5, 12.5px                        | medium / 500 / 560                   | `label`                                                        |
| 13, 13.5, 12.5px                        | `fontFamily="mono"`                  | `mono`                                                         |
| 13, 13.5, 12.5px                        | regular                              | `bodySm`                                                       |
| 12, 11.5px, `0.75rem`                   | uppercase                            | `eyebrow` (or `Eyebrow uppercase`)                             |
| 12, 11.5px                              | medium / semibold over a group       | `groupLabel` (or `Eyebrow`)                                    |
| 12, 11.5px                              | `fontFamily="mono"`                  | `monoSm` (or `MetaText mono`)                                  |
| 12, 11.5px                              | medium / 500 on a value              | `caption` + `fontWeight="medium"`                              |
| 12, 11.5px                              | regular, muted                       | `MetaText`, else `caption`                                     |
| 11, 10.5, 10px, `0.6875rem`, `0.625rem` | uppercase                            | `eyebrow`                                                      |
| 11, 10.5, 10px                          | `fontFamily="mono"`                  | `monoSm`                                                       |
| 11, 10.5, 10, 9.5, 9, 8.5, 8px          | anything else                        | `micro`                                                        |
| 6.4, 4, 0px                             | (a dot, a spacer, a hidden glyph)    | not text: remove the size; size the box                        |
| `0.85em`-`1.5em`, `2em`, `2rem`         | relative to its parent               | the parent's style, or the matching row above in px (1em = 14) |
| a bare number in a JSX prop             | `fontSize={12}`                      | treat as px and use the row above                              |
| a number an API needs                   | chart tick, Monaco or canvas option  | `TYPE_SCALE_PX.micro` / `.caption` / `.bodySm` / `.body`       |

Weights alone (no size change): `bold`, `700`, `640`, `650` become `semibold`;
`560`, `550` become `medium`; `300` becomes `normal`.

Token sizes (`fontSize="xs"`, `textStyle="sm"`) are not refused, but a line you
are already editing takes the product style: `xs` is `caption`, `sm` is `body`,
`2xs` is `micro`.

## Before and after

```tsx
// Before
<Text fontSize="13px" fontWeight="medium">{member.name}</Text>
<Text fontSize="11.5px" color="fg.muted">{hint}</Text>
<Text fontSize="11px" fontWeight="bold" textTransform="uppercase" color="fg.muted">Members</Text>
<Text fontFamily="mono" fontSize="12px" color="fg.muted">{run.id}</Text>
<Text fontSize="13.5px" fontWeight="640">{card.title}</Text>
<Text fontSize="10px" color="fg.muted">{count}</Text>
<XAxis tick={{ fill: axis, fontSize: 11 }} />

// After
<Text textStyle="label">{member.name}</Text>
<MetaText>{hint}</MetaText>
<Eyebrow uppercase>Members</Eyebrow>
<MetaText mono>{run.id}</MetaText>
<CardTitle>{card.title}</CardTitle>
<Text textStyle="micro" color="fg.muted">{count}</Text>
<XAxis tick={{ fill: axis, fontSize: TYPE_SCALE_PX.micro }} />
```

In a style object the same keys apply: `{ fontSize: "12px" }` becomes
`{ textStyle: "caption" }`; in a recipe-like map,
`{ fontSize: "13px", fontWeight: "medium" }` becomes `{ textStyle: "label" }`.

## Switching the rule on

`langwatch/no-raw-font-size` is written and tested but not registered while the
tree still holds findings (1,114 on 2026-10-10). When a measurement over
`modules enterprise/modules apps/ui` returns zero, add it to `HOUSE_RULES` in
`packages/oxlint-rules/src/index.mjs` and one `"langwatch/no-raw-font-size": "error"`
line to `packages/architecture-enforcer/oxlint.architecture.jsonc`, then
regenerate `dev/docs/lint-rules.md`.
