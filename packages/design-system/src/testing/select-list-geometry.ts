/**
 * Hit-tests a picker's search band after scrolling its rows: what a real engine draws on every
 * pixel row from the top of the dropdown to the bottom of the search field. For browser tests.
 */

export type SearchBandProbe = Readonly<{
  /** How far the rows actually scrolled; zero means the probe proved nothing. */
  scrolled: number;
  /** The rows drawn over or above the search field, by text. */
  rowsOverSearch: string[];
  /** Whether the search field is what sits under its own centre. */
  searchOnTop: boolean;
}>;

function scrollerOf(element: Element | null): HTMLElement | null {
  for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return null;
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

export async function probeSearchBand({
  search,
  scrollBy,
}: {
  search: HTMLElement;
  scrollBy: number;
}): Promise<SearchBandProbe> {
  const content = search.closest('[data-part="content"]');
  const scroller = scrollerOf(content?.querySelector('[role="option"]') ?? null);
  const before = scroller?.scrollTop ?? 0;
  if (scroller) scroller.scrollTop = before + scrollBy;
  await nextFrame();
  await nextFrame();

  const field = search.getBoundingClientRect();
  const top = content?.getBoundingClientRect().top ?? field.top;
  const x = field.left + field.width / 2;
  const rows = new Set<string>();
  for (let y = Math.ceil(top) + 1; y < field.bottom; y += 1) {
    const row = document.elementFromPoint(x, y)?.closest('[role="option"]');
    if (row) rows.add(row.textContent ?? "");
  }
  const centre = document.elementFromPoint(x, field.top + field.height / 2);
  return {
    scrolled: (scroller?.scrollTop ?? 0) - before,
    rowsOverSearch: [...rows],
    searchOnTop: centre === search || search.contains(centre),
  };
}
