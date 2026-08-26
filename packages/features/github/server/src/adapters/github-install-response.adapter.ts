import { GithubInstallResponsePort } from "../ports/github-install-response.port";

export class GithubInstallResponseAdapter extends GithubInstallResponsePort {
  static create(): GithubInstallResponseAdapter {
    return new GithubInstallResponseAdapter();
  }

  private constructor() {
    super();
  }

  successHtml(login: string): string {
    const safe = login.replace(/[^a-zA-Z0-9_-]/g, "");
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>Connected</title></head>
<body style="font:14px system-ui;color:#444;padding:24px">
<p>Connected as <strong>@${safe}</strong>. You can close this window.</p>
<script>
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        { type: "github-connected", login: ${JSON.stringify(safe)} },
        window.location.origin,
      );
    }
  } catch (e) {}
  window.close();
</script>
</body></html>`;
  }

  errorHtml(message: string): string {
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
        { type: "github-error", message: ${JSON.stringify(safe)} },
        window.location.origin,
      );
    }
  } catch (e) {}
</script>
</body></html>`;
  }
}
