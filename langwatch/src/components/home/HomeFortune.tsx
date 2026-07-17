import { chakra, HStack, Text, VStack } from "@chakra-ui/react";
import { motion } from "motion/react";
import { useState } from "react";
import { LuDices } from "react-icons/lu";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { HomeCard } from "./HomeCard";

/**
 * A fortune cookie for the observability-minded: one mono line per visit,
 * half genuinely useful (the shortcuts people never find), half fun. Fills
 * the quiet corner under setup with something worth a smile, and the dice
 * reroll it for readers who want another.
 */

const FORTUNES: string[] = [
  "⌘K opens the command bar — everything is four keystrokes away.",
  "⌘I asks Langy. It has read your traces, and it has opinions.",
  "p50 is a feeling. p99 is the truth.",
  "An eval you didn't write is a bug you scheduled.",
  "Every trace tells a story. Some of them are horror.",
  "Temperature 0 is a personality too.",
  "Name your scenarios well — future you is a stranger.",
  "The dashboard is calm. Suspiciously calm.",
];

export function HomeFortune() {
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(() =>
    Math.floor(Math.random() * FORTUNES.length),
  );

  const reroll = () =>
    setIndex((current) => {
      if (FORTUNES.length < 2) return current;
      let next = current;
      while (next === current) {
        next = Math.floor(Math.random() * FORTUNES.length);
      }
      return next;
    });

  return (
    <HomeCard cursor="default" padding={4} height="full" width="full">
      <VStack align="stretch" gap={2} width="full" height="full">
        <HStack justify="space-between" align="center" gap={3}>
          <Text
            fontFamily="mono"
            fontSize="10.5px"
            letterSpacing="0.1em"
            textTransform="uppercase"
            color="fg.subtle"
          >
            Fortune
          </Text>
          <chakra.button
            type="button"
            onClick={reroll}
            aria-label="Another fortune"
            display="grid"
            placeItems="center"
            color="fg.subtle"
            cursor="pointer"
            borderRadius="md"
            padding={1}
            transition="color 130ms ease, background 130ms ease"
            _hover={{ color: "fg", background: "bg.muted" }}
          >
            {/* The die tumbles on every roll — keyed remount spins it in. */}
            <motion.span
              key={index}
              initial={reduceMotion ? false : { rotate: -120, scale: 0.7 }}
              animate={{ rotate: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 320, damping: 16 }}
              style={{ display: "grid", placeItems: "center" }}
            >
              <LuDices size={13} />
            </motion.span>
          </chakra.button>
        </HStack>
        {/* A fresh fortune settles in like a slip pulled from the cookie:
            blurred and lifted for a beat, then sharp. */}
        <motion.div
          key={index}
          initial={
            reduceMotion
              ? false
              : { opacity: 0, y: 6, filter: "blur(4px)" }
          }
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.35, ease: "easeOut" }}
        >
          <Text
            fontFamily="mono"
            fontSize="12px"
            color="fg.muted"
            lineHeight="1.6"
          >
            {FORTUNES[index]}
          </Text>
        </motion.div>
      </VStack>
    </HomeCard>
  );
}
