/**
 * How a whole-dataset read sizes its pages: by bytes, since a row can hold inline images of
 * many megabytes. Page sizes are powers of two, so halving or doubling one keeps the rows
 * already read a whole number of pages and the next page number follows from that count.
 */

/** Rows asked for on the first page: small, since the size of the rows is not known yet. */
export const RECORDS_PAGE_LIMIT_START = 16;

/** The most rows asked for on any page. */
export const RECORDS_PAGE_LIMIT_MAX = 512;

/** The page size, in bytes, a whole-dataset read steers toward. */
export const RECORDS_PAGE_TARGET_BYTES = 16 * 1024 * 1024;

/** Datasets asked for per page when looking up one dataset's metadata. */
export const DATASETS_PAGE_LIMIT = 1000;

/** The error envelope of a response body, which some routes nest under `error`. */
function envelopeOf(error: unknown): Record<string, unknown> | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const body = error as Record<string, unknown>;
  return body.error !== null && typeof body.error === "object"
    ? (body.error as Record<string, unknown>)
    : body;
}

function errorCode(error: unknown): string | undefined {
  const envelope = envelopeOf(error);
  return [envelope?.code, envelope?.type, envelope?.kind].find(
    (candidate): candidate is string => typeof candidate === "string" && candidate.length > 0,
  );
}

/** The smaller page size a refusal names in `meta.suggestedLimit`, when it names one. */
export function suggestedLimitOf(error: unknown): number | undefined {
  const meta = envelopeOf(error)?.meta;
  if (meta === null || typeof meta !== "object") return undefined;
  const suggested = (meta as Record<string, unknown>).suggestedLimit;
  return typeof suggested === "number" && Number.isInteger(suggested) ? suggested : undefined;
}

/**
 * Whether the server refused a records page for its size. The platform answers 413 with the
 * code `dataset_page_too_large`. Any 413 is read the same way, and so is a 400 or 422 whose
 * code names a size refusal.
 */
export function isPageTooLarge({ status, error }: { status: number; error: unknown }): boolean {
  if (status === 413) return true;
  if (status !== 400 && status !== 422) return false;
  return errorCode(error)?.includes("too_large") ?? false;
}

/**
 * The page size of a whole-dataset read, adjusted after every page. A refused page halves
 * it. An accepted page halves it while the next one would pass the byte target, and doubles
 * it while the next one would stay under the target and start where this one ended.
 */
export class PageSizer {
  limit = RECORDS_PAGE_LIMIT_START;

  // A grown page can be refused when the server's cap is under the byte target. Each such
  // refusal doubles the pages read before the next attempt to grow, so a dataset of evenly
  // large rows costs only a few refused requests.
  private grown = false;
  private growthBackoffPages = 1;
  private pagesUntilGrowth = 0;

  /** The 1-based page that starts right after the rows already read. */
  pageAfter(rowsRead: number): number {
    return rowsRead / this.limit + 1;
  }

  /**
   * Lowers the page size after a refusal: to the size the refusal suggests when the rows
   * already read are a whole number of pages of that size, and to half otherwise.
   */
  shrinkAfterRefusal({ suggested, rowsRead }: { suggested?: number; rowsRead: number }): void {
    const usable =
      suggested !== undefined &&
      suggested >= 1 &&
      suggested < this.limit &&
      rowsRead % suggested === 0;
    this.limit = usable ? suggested : Math.max(1, this.limit / 2);
    if (this.grown) {
      this.pagesUntilGrowth = this.growthBackoffPages;
      this.growthBackoffPages *= 2;
      this.grown = false;
    }
  }

  /** Picks the next page size from the size of the page just read. */
  accept({
    rowsRead,
    pageRows,
    pageBytes,
  }: {
    rowsRead: number;
    pageRows: number;
    pageBytes: number;
  }): void {
    if (this.grown) this.growthBackoffPages = 1;

    const rowBytes = Math.max(1, Math.floor(pageBytes / Math.max(1, pageRows)));
    const fits = (limit: number) => limit * rowBytes <= RECORDS_PAGE_TARGET_BYTES;
    let next = this.limit;
    while (next > 1 && !fits(next)) next /= 2;
    while (
      this.pagesUntilGrowth === 0 &&
      next < RECORDS_PAGE_LIMIT_MAX &&
      rowsRead % (next * 2) === 0 &&
      fits(next * 2)
    ) {
      next *= 2;
    }

    this.pagesUntilGrowth = Math.max(0, this.pagesUntilGrowth - 1);
    this.grown = next > this.limit;
    this.limit = next;
  }
}
