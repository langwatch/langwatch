import html from "./index.html";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/guides/ai-agent-guide" || url.pathname === "/guides/ai-agent-guide/") {
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    return fetch(request);
  },
};
