import { toaster } from "@langwatch/browser-host/toaster";
import { useEffect, useRef, useState } from "react";

import { SLACK_APP_MANIFEST } from "../model/slack-app-manifest.ts";

const COPIED_FOR_MS = 1500;

/**
 * Copies the Slack app manifest, reporting "copied" briefly or a toast when the clipboard
 * refuses.
 */
export function useCopySlackAppManifest() {
  const [isCopied, setIsCopied] = useState(false);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(void 0);
  useEffect(
    () => () => {
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    },
    [],
  );

  const copyManifest = () => {
    // The Clipboard API is absent over plain HTTP, which self-hosted instances run,
    // so a missing API reads the same as a denied write.
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      copyFailed();
      return;
    }
    clipboard
      .writeText(SLACK_APP_MANIFEST)
      .then(() => {
        setIsCopied(true);
        copyResetTimer.current = setTimeout(() => setIsCopied(false), COPIED_FOR_MS);
      })
      .catch(copyFailed);
  };

  return { isCopied, copyManifest };
}

function copyFailed() {
  toaster.create({
    type: "error",
    title: "Couldn't copy the manifest",
    description: "Select the manifest text and copy it manually.",
  });
}
