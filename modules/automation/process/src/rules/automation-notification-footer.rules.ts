/**
 * `render()` returns a whole HTML document, so appending the footer would
 * land it after `</body></html>` and some clients drop content there. Insert
 * before the closing tag when present, else append (fragments, plain HTML).
 */
export function injectFooterIntoBody(html: string, footerHtml: string): string {
  const bodyClose = /<\/body>/i;

  return bodyClose.test(html)
    ? html.replace(bodyClose, `${footerHtml}</body>`)
    : `${html}${footerHtml}`;
}
