import { GitHubIcon } from "@langwatch/design-system/icons";
import { Link, Text } from "@langwatch/design-system/primitives";
import { Star } from "lucide-react";

import { site } from "../lib/nav-model.ts";

const COUNT = new Intl.NumberFormat("en-GB");

export function GithubLink({ compact }: { compact: boolean }) {
  const stars = site.stars;
  return (
    <Link
      href={site.github}
      display="inline-flex"
      alignItems="center"
      gap="2"
      minHeight="44px"
      fontSize="13px"
      color="fg.muted"
      textDecoration="none"
      aria-label={stars === null ? "GitHub" : `GitHub, ${COUNT.format(stars)} stars`}
      _hover={{ color: "fg", textDecoration: "none" }}
    >
      <GitHubIcon size={16} />
      <Text as="span" display={compact ? "none" : "inline"}>
        langwatch/langwatch
      </Text>
      {stars === null ? null : (
        <>
          <Star size={14} aria-hidden="true" />
          <Text as="span">{COUNT.format(stars)}</Text>
        </>
      )}
    </Link>
  );
}
