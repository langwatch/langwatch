import { useEffect } from "react";

type FindMatchHighlightProps = {
  traceId: string | null;
};

export function FindMatchHighlight({ traceId }: FindMatchHighlightProps) {
  useEffect(() => {
    if (!traceId) return;

    const rowGroup = document.querySelector(
      `tbody[data-trace-id="${CSS.escape(traceId)}"]`,
    );
    rowGroup?.setAttribute("data-current-find-match", "");

    return () => rowGroup?.removeAttribute("data-current-find-match");
  }, [traceId]);

  return (
    <style>{`
    tbody[data-current-find-match] > tr > td {
      background-color: color-mix(in srgb, var(--chakra-colors-yellow-fg) 18%, transparent) !important;
    }
    tbody[data-current-find-match] > tr:first-of-type > td {
      box-shadow: inset 0 2px 0 var(--chakra-colors-yellow-fg);
    }
    tbody[data-current-find-match] > tr:last-of-type > td {
      box-shadow: inset 0 -2px 0 var(--chakra-colors-yellow-fg);
    }
  `}</style>
  );
}
