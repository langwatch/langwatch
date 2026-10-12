import { chakra, VisuallyHidden } from "@langwatch/design-system/primitives";

const WIDTH = 72;
const HEIGHT = 22;
const PAD = 2;

/**
 * A run history as one thin line, scaled to its own min and max so a small move stays visible.
 * The line is hidden from assistive technology; `label` is its text equivalent.
 */
export function RunSparkline({ values, label }: { values: number[]; label: string }) {
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const points = values
    .map((value, at) => {
      const x = PAD + (at * (WIDTH - 2 * PAD)) / (values.length - 1);
      const y = HEIGHT - PAD - ((value - min) / span) * (HEIGHT - 2 * PAD);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <>
      <VisuallyHidden>{label}</VisuallyHidden>
      <chakra.svg
        aria-hidden="true"
        width={`${WIDTH}px`}
        height={`${HEIGHT}px`}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        color="blue.fg"
        flexShrink={0}
      >
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </chakra.svg>
    </>
  );
}
