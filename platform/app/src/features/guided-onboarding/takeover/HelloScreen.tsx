import { Box } from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import { useAnalytics } from "react-contextual-analytics";
import { HEADING_FONT } from "~/features/auth-front-door/frontDoorTheme";
import { helloSegments, NEXT_AFTER_TYPING_MS } from "./copy";
import { NextButton } from "./NextButton";
import { TakeoverRow } from "./TakeoverRow";
import { Typewriter } from "./Typewriter";

/**
 * Langy's hello: the greeting types out, the caret rests, and Next follows
 * once the words have had a beat to themselves.
 */
export function HelloScreen({
  firstName,
  fading,
  onNext,
}: {
  firstName: string;
  fading: boolean;
  onNext: () => void;
}) {
  const { emit } = useAnalytics();
  const [done, setDone] = useState(false);
  const [typed, setTyped] = useState(false);

  useEffect(() => {
    emit("viewed", "hello");
    // Once per mount: the screen was seen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setTyped(true), NEXT_AFTER_TYPING_MS);
    return () => clearTimeout(t);
  }, [done]);

  const segments = useMemo(() => helloSegments(firstName), [firstName]);

  return (
    <TakeoverRow fading={fading} maxWidth={640}>
      <Box
        minH="100px"
        fontFamily={HEADING_FONT}
        fontSize="36px"
        lineHeight="1.25"
        whiteSpace="pre-line"
        color="fg"
        data-testid="hello-line"
      >
        <Typewriter
          segments={segments}
          speed={34}
          onDone={() => setDone(true)}
        />
      </Box>
      <NextButton
        show={typed}
        onClick={() => {
          emit("clicked", "next", { screen: "hello" });
          onNext();
        }}
      />
    </TakeoverRow>
  );
}
