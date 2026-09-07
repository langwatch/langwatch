import { Heading, Text, VStack } from "@chakra-ui/react";
import type React from "react";
import type { StageId } from "../chapters/onboardingJourneyConfig";
import { renderHeading } from "./heroText";

interface StaticHeroProps {
  stage: StageId;
  heading: string;
  subhead?: string;
}

export function StaticHero({
  stage,
  heading,
  subhead,
}: StaticHeroProps): React.ReactElement {
  return (
    <VStack align="center" gap={4} maxWidth="58ch" textAlign="center">
      <Heading
        fontSize={{ base: "3xl", md: "4xl" }}
        letterSpacing="-0.035em"
        fontWeight={400}
        lineHeight="1.05"
        color="fg"
        whiteSpace="pre-line"
      >
        {renderHeading(stage, heading)}
      </Heading>
      {subhead && (
        <Text color="fg.muted" textStyle="md" lineHeight="1.65" maxWidth="48ch">
          {subhead}
        </Text>
      )}
    </VStack>
  );
}
