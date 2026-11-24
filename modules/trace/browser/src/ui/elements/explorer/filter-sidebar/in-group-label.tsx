import { Text } from "@langwatch/design-system/primitives";

/** The title a row a search group makes optional carries (#9810). */
export const IN_GROUP_TITLE = "Part of a group in the search bar";

/** The small label every sidebar row a search group makes optional shows beside its name. */
export function InGroupLabel() {
  return (
    <Text textStyle="2xs" color="blue.fg" fontWeight="medium" flexShrink={0} data-facet-grouped>
      in group
    </Text>
  );
}
