const COUNT = new Intl.NumberFormat("en-GB");

/** The star count as the header shows it, the same in the prerendered page and after a refresh. */
export function formatStars({ stars }: { stars: number }) {
  return COUNT.format(stars);
}

/** The GitHub link's accessible name, with the star count when there is one. */
export function githubLabel({ stars }: { stars: number | null }) {
  return stars === null ? "GitHub" : `GitHub, ${formatStars({ stars })} stars`;
}
