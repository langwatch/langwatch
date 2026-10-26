# Braids brand kit

Open [braids-brand.html](braids-brand.html). Fonts, CSS and artwork are embedded, so it works offline.

**The mark: Open weave.** Three distinct strands cross with transparent gaps and finish as staggered trace bars. It describes a shared trace without implying copied data, and works in one colour beside SSO and audit logs. Use the optical master at 16–24px, the standard master from 32px, and clear space of ¼ of the mark width.

## Decisions and sources

Website sources are in the website repository, `langwatch/2lang-2watch`. The HTML includes a linked source register with further detail.

| Decision                                                                                            | Website source                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| White, charcoal, website orange **#F56B1A**; Sentient display, Inter interface, JetBrains Mono code | [src/index.css](https://github.com/langwatch/2lang-2watch/blob/main/src/index.css)                                                                                                                                                     |
| Preserve the original watchtower and LangWatch wordmark                                             | [src/components/Logo.tsx](https://github.com/langwatch/2lang-2watch/blob/main/src/components/Logo.tsx)                                                                                                                                 |
| A named feature inside LangWatch, with a product view and concrete supporting copy                  | [src/pages/LangyPage.tsx](https://github.com/langwatch/2lang-2watch/blob/main/src/pages/LangyPage.tsx), [VariantHero.tsx](https://github.com/langwatch/2lang-2watch/blob/main/src/components/variants/VariantHero.tsx)                 |
| Static warm/cloud field, protected text, soft fade                                                  | [mesh-colors.ts](https://github.com/langwatch/2lang-2watch/blob/main/src/lib/mesh-colors.ts), [MeshHeroBackground.tsx](https://github.com/langwatch/2lang-2watch/blob/main/src/components/MeshHeroBackground.tsx)                      |
| Rounded stroke icons, crisp waterfalls; project provenance distinct from span-type colours          | [ObservabilityPage.tsx](https://github.com/langwatch/2lang-2watch/blob/main/src/pages/ObservabilityPage.tsx), [feature-visuals.md](https://github.com/langwatch/2lang-2watch/blob/main/docs/design-system/patterns/feature-visuals.md) |
| One 650ms arrival, explicit replay, reduced-motion fallback                                         | [motion.md](https://github.com/langwatch/2lang-2watch/blob/main/docs/design-system/tokens/motion.md)                                                                                                                                   |
| Concrete product nouns, British English, no em dashes or customer names                             | [copy.md](https://github.com/langwatch/2lang-2watch/blob/main/docs/design-system/copy.md), [CLAUDE.md](https://github.com/langwatch/2lang-2watch/blob/main/CLAUDE.md), user brief                                                      |

App orange **#ED8926**, Inter headings and semantic badge colours follow [config.ts](../../../../../packages/design-system/src/system/config.ts) and [color-system.ts](../../../../../packages/design-system/src/color-mode/color-system.ts). The weave improves the [prototype](../braids-prototype.html)'s `braidMark` and `hero`. Extra strand colours identify fictional projects, always with names or initials.

Current code takes precedence over older website notes that still describe unloaded fonts and purple/pink colours. No parent palette or source files were changed.

## Assets

- `braids-mark*.svg`: website and app, light/dark, monochrome and optical small masters.
- `braids-lockup.svg`, `langwatch-braids-lockup.svg`: display lockups.
- `braids-empty-state.svg`, `braids-enterprise.svg`, `braids-docs-hero.svg`: 760×350 illustrations.
- `braids-og.svg`: exact 1200×630 social card.
- `exploration-*.svg`: alternatives for comparison.

Text-bearing SVGs embed fonts and retain editable text. Design tools that ignore SVG web fonts need the website fonts installed or text outlined before print export. Mono marks use `currentColor`, black by default. Signing remains optional; provenance badges do not imply verification.

## Decided (21 October 2026)

The open weave mark and the Sentient display lockup. **“One trace. Every project.”** is the launch tagline. Inter remains the app face. Website and app orange stay as they are; unifying them is a separate decision for the LangWatch brand as a whole.

## Validation

Headless Chromium: 1440px desktop and 390px mobile, screenshots inspected; no horizontal overflow, page errors, duplicate IDs or broken internal anchors. Embedded fonts load. Tabs work with clicks and keyboard navigation. Reduced motion produces zero animations. All 14 SVGs parse. Oxfmt and whitespace checks pass. This is an isolated brand artifact, not an application code change.
