import { chakra } from "@chakra-ui/react";
import { useReducedMotion } from "~/hooks/useReducedMotion";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

/**
 * The slot a single character stands in. Every character gets the same box —
 * digits, currency symbols and the letters of "Custom pricing" alike — so the
 * figure sits on one baseline whatever it is made of, and a digit that is
 * mid-roll is clipped by a box the same height as the ones beside it.
 */
const SLOT_HEIGHT = "1.15em";

/** Long enough to read as a roll, short enough not to delay the answer. */
const ROLL_MS = 420;
/** Each place starts a breath after the one to its left, the way a dial does. */
const ROLL_STAGGER_MS = 45;
const ROLL_EASE = "cubic-bezier(0.22, 0.8, 0.2, 1)";

const digitOf = (character: string): number =>
  character >= "0" && character <= "9" ? Number(character) : -1;

/**
 * The price figure, rolled rather than swapped.
 *
 * Switching the currency or the billing period changes a number the reader is
 * looking straight at, and a number that simply becomes a different number is
 * a change you can miss while your eye is elsewhere on the row. Rolling each
 * place to its new value says WHICH figures moved, and by how far, in the time
 * it takes to look up.
 *
 * The strip is decoration and is hidden from assistive technology; the value
 * itself is carried once, as text, in a visually hidden node. A screen reader
 * hears "€29", never ten digits per place.
 *
 * Every slot is one character wide with tabular figures, so the figure holds
 * its width for the whole roll and nothing beside it moves. Somebody who has
 * asked for less motion gets the plain figure, swapped instantly, with no
 * strip rendered at all.
 */
export function PriceOdometer({
  value,
  testId,
}: {
  value: string;
  testId?: string;
}) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return (
      <chakra.span
        data-testid={testId}
        fontVariantNumeric="tabular-nums"
        whiteSpace="pre"
      >
        {value}
      </chakra.span>
    );
  }

  return (
    <chakra.span
      data-testid={testId}
      display="inline-flex"
      alignItems="flex-start"
      fontVariantNumeric="tabular-nums"
      lineHeight={SLOT_HEIGHT}
      position="relative"
    >
      <chakra.span
        position="absolute"
        width="1px"
        height="1px"
        margin="-1px"
        padding="0"
        overflow="hidden"
        whiteSpace="nowrap"
        clipPath="inset(50%)"
        borderWidth="0"
      >
        {value}
      </chakra.span>
      <chakra.span aria-hidden="true" display="inline-flex">
        {[...value].map((character, index) => (
          // A slot is a POSITION in the figure, not a character: keyed by what
          // it currently shows, every slot would remount on every change and
          // throw away the transition this component exists for.
          <PriceSlot
            key={`slot-${index}`}
            character={character}
            index={index}
          />
        ))}
      </chakra.span>
    </chakra.span>
  );
}

function PriceSlot({ character, index }: { character: string; index: number }) {
  const digit = digitOf(character);

  if (digit === -1) {
    return (
      <chakra.span display="inline-block" height={SLOT_HEIGHT} whiteSpace="pre">
        {character}
      </chakra.span>
    );
  }

  return (
    <chakra.span
      display="inline-block"
      width="1ch"
      height={SLOT_HEIGHT}
      overflow="hidden"
    >
      <chakra.span
        display="block"
        transform={`translateY(-${digit * 10}%)`}
        transition={`transform ${ROLL_MS}ms ${ROLL_EASE}`}
        transitionDelay={`${index * ROLL_STAGGER_MS}ms`}
        willChange="transform"
      >
        {DIGITS.map((eachDigit) => (
          <chakra.span
            key={eachDigit}
            display="block"
            height={SLOT_HEIGHT}
            textAlign="center"
          >
            {eachDigit}
          </chakra.span>
        ))}
      </chakra.span>
    </chakra.span>
  );
}
