import { Box } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { IdentityChip } from "~/components/access/IdentityRow";
import { SettingList, SettingRow } from "~/components/settings/kit/SettingRow";
import { SettingsCard } from "~/components/settings/kit/SettingsCard";

/**
 * One of the two things an administrator came to check.
 *
 * The overview answers two questions side by side — how people sign in, and
 * how their accounts arrive — and they only read as one answer if they are
 * drawn the same way. That shape is no longer described here: it is
 * `SettingsCard`, which every page in the settings cluster now uses, so
 * Authentication cannot quietly drift into a dialect of its own.
 *
 * What survives is this card's own vocabulary — a chip that says where this
 * half of authentication stands — mapped onto the kit's status tone.
 */
export function OverviewCard({
  title,
  hint,
  leading,
  chip,
  children,
  actions,
  "data-testid": testId,
}: {
  title: string;
  /** What this card is about, in one line. */
  hint?: ReactNode;
  /** The protocol's or the vendor's mark, before the name. */
  leading?: ReactNode;
  /** Where this half of authentication stands. Never a raw state name. */
  chip?: {
    label: string;
    tone: "neutral" | "good" | "warning" | "bad";
    title: string;
    /** A state that is waiting on the reader rather than on a system. */
    shimmer?: boolean;
  };
  children: ReactNode;
  actions?: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <SettingsCard
      title={title}
      hint={hint}
      leading={leading}
      // The dot and the chip say the same thing, which is the point: the dot
      // is what makes a column of cards scannable, the chip is what a reader
      // who does not see the colour gets instead.
      tone={chip ? statusToneFor(chip.tone) : undefined}
      badge={
        chip && (
          <IdentityChip
            label={chip.label}
            tone={chip.tone}
            title={chip.title}
            shimmer={chip.shimmer}
          />
        )
      }
      actions={actions}
      data-testid={testId}
    >
      {/* The facts are a LIST, hairline-separated, rather than a stack of
          loose blocks. It is what turns a card of five facts into one object
          somebody reads down instead of five they read separately. */}
      <SettingList>{children}</SettingList>
    </SettingsCard>
  );
}

/**
 * THE ONE TRANSLATION BETWEEN THE TWO TONE VOCABULARIES. The chips these
 * cards wear speak `IdentityChip`'s words (`good` and its neighbours); the
 * kit's dot and tone speak `ok` and its. Every card in this directory passes
 * its chip through `OverviewCard`, so the mapping lives exactly once, here —
 * a card that translated its own tone would be a second answer to a question
 * that only wants one.
 */
function statusToneFor(
  tone: "neutral" | "good" | "warning" | "bad",
): "ok" | "warning" | "bad" | "neutral" {
  if (tone === "good") return "ok";
  if (tone === "warning") return "warning";
  if (tone === "bad") return "bad";
  return "neutral";
}

/**
 * One labelled fact inside a card.
 *
 * NAME LEFT, VALUE RIGHT, and vertically centred — which is the whole change.
 * These used to stack a small-caps label above its value, so a card of five
 * facts put five values in five different places and became five separate
 * reads instead of one column an administrator could scan. Centred, because a
 * one-line name floating above a taller control beside it made a deliberate
 * list look accidental.
 */
export function OverviewDetail({
  label,
  hint,
  children,
}: {
  label: string;
  /** What this fact means, for the reader who does not already know. */
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SettingRow label={label} hint={hint}>
      {/* The value wears the row's own size — 13px, the label's — by default,
          stated once here rather than re-typed as a literal on every row of
          every card. Chips and controls carry their own size and ignore
          this. */}
      <Box fontSize="13px">{children}</Box>
    </SettingRow>
  );
}
