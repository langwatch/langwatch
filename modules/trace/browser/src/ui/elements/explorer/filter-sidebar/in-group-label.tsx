import { Text } from "@langwatch/design-system/primitives";

type GroupedState = "grouped-include" | "grouped-exclude";

/** The title a row a search group makes optional carries (#9810). */
const IN_GROUP_TITLE = "Part of a group in the search bar";

/**
 * What a click on a row in a group does (#9863). It reads the query's sign, a plain term first: a
 * plain one is excluded from every result, a negated one is removed from its group.
 */
function inGroupClickAction(state: GroupedState): string {
  return state === "grouped-exclude" ? "remove from the group" : "exclude";
}

/** A grouped row's title: the group, then what a click does. */
export function inGroupTitle(state: GroupedState): string {
  return `${IN_GROUP_TITLE}. Click to ${inGroupClickAction(state)}.`;
}

/** The state words a grouped row's accessible name carries after its label. */
export function inGroupStateLabel(state: GroupedState): string {
  return `in group, click to ${inGroupClickAction(state)}`;
}

/** The small label every sidebar row a search group makes optional shows beside its name. */
export function InGroupLabel() {
  return (
    <Text textStyle="2xs" color="blue.fg" fontWeight="medium" flexShrink={0} data-facet-grouped>
      in group
    </Text>
  );
}
