# Langy card taxonomy

Every card Langy renders in the conversation is one of **five intents**, ordered
by **attention weight** — how much of the reader's attention the card is allowed
to take. The intent, not the component, fixes the material: sizing, surface,
border emphasis, whether the warm amber accent is spent, and the default
status-dot tone.

The system lives in `tokens.ts` (`CARD_TAXONOMY`, `LangyCardIntent`) and is
rendered by one primitive, `LangyCard`. A card's weight is a data decision made
once, not re-invented per component.

## The one rule: warmth is earned

Only `ask` and `spotlight` spend the amber accent. A wall of warm cards reads as
noise, so the lower-weight receipts stay on the quiet neutral hairline. If a card
is not asking you for something or showing you a headline result, it is not warm.

## The five intents

| Intent      | Weight       | It says                                    | Material                                                                                |
| ----------- | ------------ | ------------------------------------------ | --------------------------------------------------------------------------------------- |
| `activity`  | 1 (quietest) | a small piece of work is happening         | an inline status line, no box; a small dot, muted text                                  |
| `progress`  | 2            | the thing you asked for is under way       | a hairline receipt (`bg.subtle`, `border.muted`), a live amber dot while it runs        |
| `change`    | 3            | something was created, updated, or removed | a settled hairline receipt, a status dot naming the outcome (green / rust)              |
| `ask`       | 4            | Langy needs a decision from you            | leans in with the warm accent border + wash; an action row is expected                  |
| `spotlight` | 5 (loudest)  | something worth your full attention        | the panel material (`LangyPanelSurface`), surface tone, a serif title, generous padding |

## Using `LangyCard`

```tsx
import { LangyCard } from "~/features/asaplangy";

// A live receipt — the amber dot pulses while it runs.
<LangyCard intent="progress" overline="In progress" title="Analysing 1,204 traces" pulseDot>
  <SomeBody />
</LangyCard>

// A settled change — a green outcome dot.
<LangyCard intent="change" overline="Created" dot="green.fg" title="Faithfulness evaluator added" />

// A decision — the warm accent, an action row.
<LangyCard intent="ask" overline="Needs you" title="Add a faithfulness evaluator?" actions={<ApplyDiscard />}>
  <Rationale />
</LangyCard>
```

Props:

- `intent` — the taxonomy variant (required).
- `overline` — mono eyebrow (a node, so you can fold an icon in). The status dot
  leads it on the boxed non-spotlight intents.
- `title` — a string is styled per the intent (serif on `spotlight`); a node is
  rendered as-is when you need a custom header (an error icon + title, say).
- `dot` — status-dot colour override; defaults to the intent's tone.
- `showDot` / `pulseDot` — force the dot on/off; pulse it while work is live.
- `actions` — the actions row (Apply / Discard / retry). Expected on `ask`.
- `role` / `aria-label` — pass `role="alert"` for error cards.

The primitive owns the weight → material mapping. It reuses `LangyPanelSurface`
for the `spotlight` hero and the shared `.langy-accent-wash` / `.langy-accent-ring`
CSS (both Display-P3 aware) for the `ask` accent, so a card and the home panel
read as one material.

## Reference implementation

`LangyPlanCard` is the reference: a `progress` card. `LangyCardGallery` shows all
five intents in the "Card taxonomy" section (developer mode → Card gallery).

## Migrating the other cards

The other card components predate the taxonomy and hand-roll their box. Map each
onto an intent and replace the outer container with `LangyCard`:

| Component                                                         | Intent                                     |
| ----------------------------------------------------------------- | ------------------------------------------ |
| `LangyPlanCard`                                                   | `progress` (done — the reference)          |
| `LangyCapabilityPendingCard`                                      | `progress`                                 |
| `LangyToolActivity` lines                                         | `activity`                                 |
| `LangyCapabilityCard` (tone `read`)                               | `change` (neutral dot)                     |
| `LangyCapabilityCard` (tone `created` / `updated` / `removed`)    | `change`                                   |
| `LangyError` (card mode) / `LangyToolErrorCard`                   | `change` (rust dot, `role="alert"`) — done |
| `ProposalCard` (create / update / destructive)                    | `ask`                                      |
| A rich result worth the headline (trace sample, PR card, metrics) | `spotlight`                                |

Migrate one card at a time; the material is identical for the receipt intents
(`progress` / `change`) so those are drop-in, and the ramp keeps the whole kit
reading as one system.
