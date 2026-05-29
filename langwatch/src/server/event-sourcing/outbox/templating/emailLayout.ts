const LOGO_URL = "https://app.langwatch.ai/images/logo-icon.png";

/**
 * Wraps a rendered (sanitized) email body in the LangWatch frame: logo header
 * and bordered container. `prefixHtml` is reserved for backend-injected,
 * non-template content such as the test-fire banner, which must sit above the
 * customer body.
 */
export function wrapEmailHtml({
  bodyHtml,
  prefixHtml = "",
}: {
  bodyHtml: string;
  prefixHtml?: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
  <body style="margin:0;padding:0;background-color:#ffffff;">
    <div style="border:1px solid #F2F4F8;border-radius:10px;padding:24px;padding-bottom:12px;max-width:600px;margin:0 auto;font-family:Helvetica,Arial,sans-serif;color:#1A202C;">
      <img src="${LOGO_URL}" alt="LangWatch Logo" width="36" />
      ${prefixHtml}
      ${bodyHtml}
    </div>
  </body>
</html>`;
}
