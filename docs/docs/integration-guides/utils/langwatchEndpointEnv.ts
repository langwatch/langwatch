export const langwatchEndpointEnv = () => {
  if (typeof window === "undefined") {
    return "";
  }
  if (
    window.location.hostname !== "app.langwatch.ai" &&
    window.location.hostname !== "docs.langwatch.ai"
  ) {
    return `export LANGWATCH_ENDPOINT='${window.location.protocol}//${
      window.location.hostname
    }${
      window.location.port && !["80", "443"].includes(window.location.port)
        ? `:${window.location.port}`
        : ""
    }'\n`;
  }

  return "";
};
