interface CurrentMatchHighlightProps {
  traceId: string | null;
}

export function CurrentMatchHighlight({ traceId }: CurrentMatchHighlightProps) {
  if (!traceId) return null;

  const selector = `tbody[data-trace-id="${CSS.escape(traceId)}"]`;
  const css = `
    ${selector} > tr > td {
      background-color: color-mix(in srgb, var(--chakra-colors-yellow-fg) 18%, transparent) !important;
    }
    ${selector} > tr:first-of-type > td {
      box-shadow: inset 0 2px 0 var(--chakra-colors-yellow-fg);
    }
    ${selector} > tr:last-of-type > td {
      box-shadow: inset 0 -2px 0 var(--chakra-colors-yellow-fg);
    }
  `;

  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
