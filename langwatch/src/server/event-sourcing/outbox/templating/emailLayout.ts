const LOGO_URL = "https://app.langwatch.ai/images/logo-icon.png";

export interface EmailFrameFooter {
  /** Project home — anchor on the "LangWatch" word. */
  projectUrl: string;
  /** Deep link back into the automation that produced this email. */
  editUrl: string;
}

/**
 * Wraps a rendered (sanitized) email body in the LangWatch frame: logo header,
 * bordered container, and a footer with the LangWatch attribution + a link
 * back to the producing automation. Authors edit the body in the middle —
 * the chrome is non-template (see ADR-028), so every email has a consistent
 * header/footer regardless of what the customer template does.
 *
 * `prefixHtml` is reserved for backend-injected, non-template content such
 * as the test-fire banner, which must sit above the customer body.
 */
export function wrapEmailHtml({
  bodyHtml,
  prefixHtml = "",
  footer,
}: {
  bodyHtml: string;
  prefixHtml?: string;
  footer: EmailFrameFooter;
}): string {
  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
  <body style="margin:0;padding:0;background-color:#ffffff;">
    <div style="border:1px solid #F2F4F8;border-radius:10px;padding:24px;padding-bottom:12px;max-width:600px;margin:0 auto;font-family:Helvetica,Arial,sans-serif;color:#1A202C;">
      <img src="${LOGO_URL}" alt="LangWatch Logo" width="36" />
      ${prefixHtml}
      ${bodyHtml}
      <hr style="border:none;border-top:1px solid #E2E8F0;margin:28px 0 12px 0;"/>
      <div style="font-size:12px;color:#718096;text-align:center;line-height:1.6;">
        Sent with <span style="color:#E53E3E;">♥</span> from
        <a href="${footer.projectUrl}" style="color:#DD6B20;text-decoration:none;">LangWatch</a>
        &nbsp;·&nbsp;
        <a href="${footer.editUrl}" style="color:#DD6B20;text-decoration:none;">Edit automation</a>
      </div>
    </div>
  </body>
</html>`;
}
