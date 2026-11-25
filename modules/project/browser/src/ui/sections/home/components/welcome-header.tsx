import { Heading } from "@langwatch/design-system/primitives";

import { SERIF } from "../../../../model/langy/asaplangy-tokens.ts";
import { useProjectHomeHost } from "../../../../model/project-home-host.ts";
import { getGreeting, getGreetingName, useTimeOfDay } from "./welcome-header.model.ts";

export function WelcomeHeader() {
  const currentUser = useProjectHomeHost().currentUser();
  const greetingName = getGreetingName(currentUser?.name);
  const timeOfDay = useTimeOfDay();

  return (
    // The page's serif display voice: the greeting is the home's one big line,
    // so it speaks in the serif display face.
    <Heading as="h1" fontFamily={SERIF} textStyle="pageTitle" fontWeight="500">
      {getGreeting({ timeOfDay, name: greetingName })}
    </Heading>
  );
}
