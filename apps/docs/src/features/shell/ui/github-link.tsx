import { GitHubIcon } from "@langwatch/design-system/icons";
import { Link, Text } from "@langwatch/design-system/primitives";
import { Star } from "lucide-react";

import type { SiteMeta } from "../../navigation/model.ts";
import { formatStars, githubLabel } from "../model/github-stars.ts";

export function GithubLink({ site }: { site: Pick<SiteMeta, "github" | "stars"> }) {
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
      aria-label={githubLabel({ stars })}
      data-docs-github=""
      _hover={{ color: "fg", textDecoration: "none" }}
    >
      <GitHubIcon size={16} />
      {/* Rendered even without a build-time count, so the browser can fill in a live one. */}
      <Text
        as="span"
        display="inline-flex"
        alignItems="center"
        gap="2"
        data-docs-stars=""
        hidden={stars === null}
      >
        <Star size={14} aria-hidden="true" />
        <Text as="span" data-docs-stars-count="">
          {stars === null ? "" : formatStars({ stars })}
        </Text>
      </Text>
    </Link>
  );
}
