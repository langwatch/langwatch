import { Spacer } from "@chakra-ui/react";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { AddPromptButton } from "./AddPromptButton";

/**
 * PromptsRailHeader
 *
 * Single Responsibility: Head the rail that lists the project's prompts, and
 * offer the one action that adds to that list.
 *
 * The action belongs here because this is the surface that enumerates prompts.
 * It used to sit in the tab strip on the far side of the workspace, which put
 * the whole width of the screen between the list and the way to add to it.
 *
 * The rail is narrow, so the button runs at the smallest scale that still
 * carries its label. It keeps the label rather than shrinking to a bare "+":
 * this is the action a first-time user is looking for.
 */
export function PromptsRailHeader() {
  return (
    <PageLayout.Header withBorder={false}>
      <PageLayout.Heading>Prompts</PageLayout.Heading>
      <Spacer />
      <AddPromptButton size="xs" />
    </PageLayout.Header>
  );
}
