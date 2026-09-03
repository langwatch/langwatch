// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The pieces of reading a provider's admin usage report that do not vary by
 * provider.
 *
 * The OpenAI and Anthropic admin pullers each had their own copy of these
 * three, byte for byte, along with the byte cap below. Everything else about
 * the two — the cursor shape, the query identity, the report URL, the default
 * start — genuinely differs, and those stay where they are. Only what is
 * actually the same rule is shared, so this file does not become the place
 * provider differences come to hide.
 *
 * The dimension rules are the ones worth having in one place: they decide a
 * row's identity, and two pullers disagreeing about identity is double-counted
 * spend rather than a formatting difference.
 */
export class AdminUsageReport {
  /**
   * How much of a failed response body is kept for the error message. Enough
   * to carry a provider's own explanation, bounded because the body on a
   * failure is not something we control the size of.
   */
  private static readonly MAX_ERROR_BODY_BYTES = 4_096;

  /**
   * Dimension values are the identity of a row, so an absent one has to be a
   * STABLE token rather than an omitted key: dropping a dimension from one
   * pull and including it as null on the next would mint two keys for one row
   * and double-count it.
   */
  static dimension(value: string | null): string {
    return value ?? "";
  }

  /**
   * The dimension values as one `:`-delimited string, each value encoded
   * first.
   *
   * `line_item` is free text the provider writes and can contain the
   * delimiter. Joined raw, two distinct rows can produce the identical string
   * and collapse onto one `source_event_id`, which is the OCSF sink's dedup
   * key. Encoding first makes the separator unambiguous. The restatement key
   * is unaffected — it hashes the map through `JSON.stringify`, which escapes
   * rather than concatenates — this is about the readable identity that rides
   * beside it.
   */
  static dimensionPath(dimensions: Record<string, string>): string {
    return Object.values(dimensions).map(encodeURIComponent).join(":");
  }

  /**
   * A failed response's body, or an empty string.
   *
   * Reading the body of a response that already failed can itself fail — a
   * dropped connection mid-read is the ordinary case — and that must not
   * replace the error being reported with a second one about reading it.
   */
  static async safeResponseText(response: { text(): Promise<string> }): Promise<string> {
    try {
      const raw = await response.text();
      if (raw.length <= AdminUsageReport.MAX_ERROR_BODY_BYTES) return raw;

      return `${raw.slice(0, AdminUsageReport.MAX_ERROR_BODY_BYTES)}… [truncated]`;
    } catch {
      return "";
    }
  }
}
