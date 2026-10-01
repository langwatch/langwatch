// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { getHexColorForString } from "@langwatch/design-system/rotating-colors";

import { PROJECTION_INK } from "./cost-chart-parts.tsx";

/** Opacity of a series over the months that were actually measured. */
const MEASURED_FILL = 0.42;
/** Opacity of the same series over the months still to come. */
const PROJECTED_FILL = 0.07;

/**
 * An id safe to hang a `<defs>` entry on. Series keys are agent names and
 * model names, which are free to carry characters a URL reference is not.
 */
export function defsId(prefix: string, key: string): string {
  return `${prefix}-${key.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

/**
 * The paints the forecast chart draws with: one fill gradient and one stroke
 * gradient per series, plus the hatch laid over the projected span.
 *
 * Called as a plain function, not rendered as `<ForecastDefs />`, for the same
 * reason `ChartLegend` is — recharts inspects the type of each direct child to
 * decide what it is, and a wrapper component is not a `defs` as far as that
 * inspection goes.
 *
 * `splitAt` is where the projection begins as a fraction of the plot's width.
 * TWO STOPS AT THAT ONE OFFSET is what makes it a hard edge rather than a
 * fade: the reader should see where measurement stopped, not a slow dissolve
 * that leaves the boundary a matter of opinion. With nothing projected the
 * split sits at 1 and every series is solid all the way across.
 */
export function ForecastDefs({
  keys,
  splitAt,
}: {
  keys: { key: string; label: string }[];
  splitAt: number | null;
}) {
  const edge = splitAt ?? 1;
  return (
    <defs>
      {keys.map((k) => {
        const color = getHexColorForString(k.label);
        return (
          <linearGradient
            key={k.key}
            id={defsId("cost-forecast-fill", k.key)}
            x1="0"
            y1="0"
            x2="1"
            y2="0"
          >
            <stop offset={0} stopColor={color} stopOpacity={MEASURED_FILL} />
            <stop offset={edge} stopColor={color} stopOpacity={MEASURED_FILL} />
            <stop offset={edge} stopColor={color} stopOpacity={PROJECTED_FILL} />
            <stop offset={1} stopColor={color} stopOpacity={PROJECTED_FILL} />
          </linearGradient>
        );
      })}
      {keys.map((k) => {
        const color = getHexColorForString(k.label);
        return (
          <linearGradient
            key={k.key}
            id={defsId("cost-forecast-line", k.key)}
            x1="0"
            y1="0"
            x2="1"
            y2="0"
          >
            <stop offset={0} stopColor={color} stopOpacity={1} />
            <stop offset={edge} stopColor={color} stopOpacity={1} />
            <stop offset={edge} stopColor={color} stopOpacity={0.4} />
            <stop offset={1} stopColor={color} stopOpacity={0.4} />
          </linearGradient>
        );
      })}
      <pattern
        id="cost-forecast-hatch"
        width={6}
        height={6}
        patternTransform="rotate(45)"
        patternUnits="userSpaceOnUse"
      >
        <line
          x1={0}
          y1={0}
          x2={0}
          y2={6}
          stroke={PROJECTION_INK}
          strokeWidth={1}
          strokeOpacity={0.35}
        />
      </pattern>
    </defs>
  );
}
