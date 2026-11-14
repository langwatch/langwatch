import { LOGO_LINES_PATH, LOGO_PLATE_PATH } from "@langwatch/design-system/logo-paths";

/* The brand page's watchtower: the LangWatch mark standing on a dashed isometric floor, in the
   site's orange. The mark (38 by 52) is scaled to 73% of the 440 by 360 frame, as there. */
const MARK = "translate(124 3) scale(5.06)";

export function Castle() {
  return (
    <figure className="docs-nf-art">
      <div className="docs-nf-art-label" aria-hidden="true">
        <span>The LangWatch mark</span>
        <span>404</span>
      </div>
      <svg className="docs-castle" viewBox="0 0 440 360" aria-labelledby="docs-castle-title">
        <title id="docs-castle-title">The LangWatch watchtower, with no page to watch.</title>
        <g className="docs-castle-floor" fill="none">
          <path d="M220 165 409 260 220 355 31 260Z" opacity=".45" />
          <path d="M220 190 361 260 220 330 79 260Z" opacity=".65" />
          <path className="docs-castle-tile" d="M220 215 311 260 220 305 129 260Z" opacity=".8" />
          <path
            d="m32 164 47 24m282 0 47-24M220 310v24M31 260h378M220 165v190"
            strokeDasharray="3 5"
          />
        </g>
        <g data-nf-mark="" transform={MARK}>
          <path className="docs-castle-plate" d={LOGO_PLATE_PATH} />
          <path className="docs-castle-lines" d={LOGO_LINES_PATH} />
        </g>
      </svg>
      <figcaption>
        <span>A little perspective, and still no page.</span>
        <span>LangWatch</span>
      </figcaption>
    </figure>
  );
}
