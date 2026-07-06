/**
 * HTML shims served back to the popup window at the end of the GitHub OAuth
 * dance. They `postMessage` the result to the opener (same-origin only) and
 * close themselves so the in-chat connect card can pick the conversation back
 * up where it left off. Issue #4747.
 *
 * The regexes are the load-bearing escape — `login` flows into HTML text and
 * `message` into both HTML and JSON. Keep them strict.
 */

export function popupResponseHtml(login: string): string {
  const safe = login.replace(/[^a-zA-Z0-9_-]/g, "");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Connected</title></head>
<body style="font:14px system-ui;color:#444;padding:24px">
<p>Connected as <strong>@${safe}</strong>. You can close this window.</p>
<script>
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        { type: "langy-github-connected", login: ${JSON.stringify(safe)} },
        window.location.origin,
      );
    }
  } catch (e) {}
  window.close();
</script>
</body></html>`;
}

export function popupErrorHtml(message: string): string {
  const safe = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Connection failed</title></head>
<body style="font:14px system-ui;color:#a00;padding:24px">
<p>GitHub connection failed: ${safe}</p>
<script>
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        { type: "langy-github-error", message: ${JSON.stringify(safe)} },
        window.location.origin,
      );
    }
  } catch (e) {}
</script>
</body></html>`;
}
