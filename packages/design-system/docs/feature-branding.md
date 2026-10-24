# How features are branded

Most of LangWatch speaks with one voice: the LangWatch logo, Inter, the app orange and the
semantic tokens. A few features earn a brand of their own inside it: a name, a mark, a tagline,
colour roles and a small set of illustrations. This guide is how any feature gets one, with
Braids (spans from one project shown in another project's traces) as the worked example.

| Export                                          | Component             | What it draws                                             |
| ----------------------------------------------- | --------------------- | --------------------------------------------------------- |
| `@langwatch/design-system/feature-mark`         | `FeatureMark`         | The mark: colour, one colour, or the small master         |
| `@langwatch/design-system/feature-lockup`       | `FeatureLockup`       | Mark plus the name in the display face, optional tagline  |
| `@langwatch/design-system/feature-illustration` | `FeatureIllustration` | The feature's art: `empty-state`, `enterprise` and `hero` |
| `@langwatch/design-system/enterprise-pill`      | `EnterprisePill`      | The quiet ENT chip, alike in the sidebar and a page title |

In Storybook: Brand/Feature branding (the whole kit on one page), Brand/Feature mark,
Brand/Feature lockup, Brand/Feature illustration, Brand/Enterprise pill and the feature rows in
Foundations/Colour.

## When a feature earns a brand

A brand costs attention. Give one only when all of these hold:

- the feature has a name people will say ("set up a braid"), not a description;
- it has its own landing page or docs page and a launch;
- it is something a buyer chooses, often an Enterprise capability, not a setting or a tab.

Everything else uses the product look unchanged. A settings page does not get a mark.

## Inside the product

A branded feature's screens are built from the app's own components. The brand sits on top in
three places only: the mark beside the page title, the art where the feature explains itself,
and the mark on whatever the feature adds to other screens.

- **Product components first.** Page header, tabs, tables, dialogs, settings rows, empty, upgrade
  and error states are the app's own: `PageLayout`, `ContentTabs`, `ListTable`, `Dialog`,
  `SettingsSection` and `SettingsField`, `NoDataInfoBlock`, `AccessState`. No custom panels.
- **The mark leads the title, in colour.** `FeatureMark` at 20px sits before the page title, and
  the Enterprise chip after it when the plan gates the feature. Buttons and table rows carry none.
- **One Enterprise chip.** `EnterprisePill` is the quiet ENT chip the sidebar shows, and a gated
  page's title wears the same one. Never an orange pill or a second wording.
- **The art explains, once.** The empty state before anything exists and the upgrade show the
  illustration inside a `Card` or `AccessState`, with the app's type scale around it. Its lines
  are drawn as the mark is: solid, one curve for every crossing, a clean gap where a strand passes
  under another. The crossings sit together in one even braid, not spread across the canvas, and
  each strand ends on a dot level with the row it feeds. Never dotted or tangled.
- **Projects look like projects.** A project is a round avatar with its initial, in the art as in
  the app's project switcher, and the art's project colours are the app's avatar hues.
- **Meaning through semantic tokens.** Errors, warnings and successes use `fg.error`,
  `fg.warning` and `fg.success`. A badge, outline or bar is never painted in the feature's lead,
  and a span bar keeps its span type's colour.

Braids shows all of these: the mark and ENT chip lead its titles, its settings are plain settings
rows, its dialog is laid out as New role is, the empty tab and the upgrade carry the braid art,
and a braided span carries the mark and a chip naming its project, like the model chip beside it.

## The parts

| Part             | What it is                                                                 | Braids                                                       |
| ---------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Name             | One word, title case, used in copy as a noun                               | Braids                                                       |
| Mark             | A small drawing on a 40 by 40 canvas, a standard master and a small master | The open weave: three strands crossing with transparent gaps |
| Lockup           | Mark beside the name in Sentient, the display face                         | `FeatureLockup feature="braids"`                             |
| Tagline          | One short line for landing pages and the lockup                            | One trace. Every project.                                    |
| Colour roles     | Named tokens under `feature.<name>.*`, light and dark values               | `lead`, `weave`, `project.1-3`, `projectInk.1-3`             |
| Illustration set | An empty state, an Enterprise upsell and a hero, 760 wide                  | Three projects braided into one trace                        |
| Motion           | At most one arrival animation, in the hero                                 | Strands weave in over 650ms, spans land after                |
| Enterprise chip  | The sidebar's ENT chip, after the title of any page the plan gates         | `EnterprisePill`                                             |

Inside the product, page titles stay in Inter. Sentient appears only in the lockup and on
landing or docs pages, as Langy and the front door already use it.

## The rules

1. **Marks are inline TSX, never image files.** The brand kit's SVGs are the source, not the
   asset. Translate the path data into `src/components/brand/<feature>-paths.ts` and draw it with
   `chakra.svg` and `chakra.path`, as `logo-paths.ts` and `logo-icon.tsx` do for the LangWatch
   mark. An image file cannot follow the colour mode and carries its own colours.
2. **Colour only through tokens.** Every fill and stroke names a semantic token: a feature role
   (`feature.braids.lead`), or a general one for surfaces and text (`bg.panel`, `border`,
   `fg.muted`). Hex lives only in `src/system/config.ts`. The one exception is mask luminance
   (`white` keeps, `black` cuts), which is not paint.
3. **The app orange stays the app's.** A feature never introduces a second orange. Its lead role
   points at `{colors.orange.solid}` (#ED8926). The website orange (#F56B1A) in a brand kit is
   not adopted in the app; unifying the two is a separate decision for the LangWatch brand.
4. **Light and dark.** Every role has a light and a dark value. Every component takes
   `forceColorMode` for surfaces that are always dark or always light.
5. **A small master at 24px and below.** Thin strokes vanish at navigation sizes. The mark ships
   an optical small master (heavier strokes, wider gaps, wider spread) and `FeatureMark` switches
   to it at 24px and below on its own; `variant="small"` forces it.
6. **One colour where it sits beside other one-colour marks.** `variant="mono"` paints every
   strand in `currentColor`: next to SSO and audit-log icons, in menus, as an empty state's icon.
7. **Unique ids per instance.** Masks and gradients take their id from React's `useId`, never a
   constant. Two marks on one page must not share a mask, or the second draws with the first's
   cut-outs, or not at all.
8. **Decorative art is hidden.** Illustrations are `aria-hidden`; the copy beside them carries
   the meaning. A mark is hidden too unless it stands alone, where it takes `label`.
9. **Motion plays once and never under reduced motion.** Only the hero animates. It plays on
   mount and finishes; it does not loop or replay on re-render. With
   `prefers-reduced-motion: reduce` or `animate={false}` it renders in its final state. To
   replay on purpose, remount it with a new `key`.
10. **Example data is fictional and labelled.** Project names in the art are invented, and every
    project colour is paired with its initial, so colour is never the only cue.

## Branding the next feature

1. **Decide the brand.** The kit lives in `dev/docs/plans/<feature>/brand/` with a README that
   records what was decided and when (Braids: `dev/docs/plans/braids/brand/README.md`). Name,
   mark, tagline and colour roles are decided there before any code.
2. **Translate the mark.** Create `src/components/brand/<feature>-paths.ts` with a standard and
   a small `MarkMaster`: each strand's path, its colour role and which strand crosses over it.
   Braids: `braids-paths.ts`, from `braids-mark-app.svg` and `braids-mark-small.svg`.
3. **Add the colour roles.** In `src/system/config.ts`, under `feature`, add
   `<feature>: { lead, weave, ... }` with `_light` and `_dark`. Point the lead at the app orange.
   Add the tokens to `featureColours` in `src/system/colour.stories.tsx`.
4. **Register the feature.** Add it to `FEATURE_BRANDS` in `src/components/brand/feature-brands.ts`
   (name, tagline, both masters) and to `FEATURE_NAMES`. `FeatureMark` and `FeatureLockup` then
   draw it with no further change.
5. **Draw the illustrations.** Add the feature's art component to `ART` in
   `feature-illustration.tsx`, drawing the three names from its paths file with tokens only.
   If a mark is not stroked strands, extend `MarkMaster` rather than writing a second component.
6. **Stories and scenarios.** Add the feature's states to the three Brand stories and the Brand/
   Feature branding page. Add scenarios to `specs/feature-*.feature` bound to
   `renderWithDesignSystem` tests: colour from tokens, mono in `currentColor`, the small master,
   unique ids, forced colour mode, reduced motion.
7. **Use it.** The feature's screens import the three subpaths; they never copy the paths or the
   colours.

```tsx
import { FeatureIllustration } from "@langwatch/design-system/feature-illustration";
import { FeatureLockup } from "@langwatch/design-system/feature-lockup";
import { FeatureMark } from "@langwatch/design-system/feature-mark";

<FeatureLockup feature="braids" size="lg" tagline />;
<FeatureMark feature="braids" size={16} variant="mono" />;
<FeatureIllustration feature="braids" name="empty-state" />;
```

## Braids, from kit to code

| Kit file                                                   | In the design system                                      |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| `braids-mark-app.svg`, `braids-mark-app-dark.svg`          | `FeatureMark feature="braids"`, light and dark            |
| `braids-mark-mono.svg`                                     | `variant="mono"`                                          |
| `braids-mark-small.svg`                                    | the small master, automatic at 24px and below             |
| `braids-lockup.svg`                                        | `FeatureLockup feature="braids"`                          |
| `braids-empty-state.svg`                                   | `FeatureIllustration name="empty-state"`                  |
| `braids-enterprise.svg`                                    | `FeatureIllustration name="enterprise"`, follows the mode |
| `braids-docs-hero.svg`, the prototype's `hero()`           | `FeatureIllustration name="hero"`, with the weave         |
| `braids-mark.svg`, `braids-mark-dark.svg`, `braids-og.svg` | website only: they use the website orange                 |

Where the code departs from the kit: the Enterprise art follows the colour mode instead of being
always dark, and the second and third projects' initials are dark on the dark-mode colours, so
they keep their contrast.
