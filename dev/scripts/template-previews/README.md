# Template preview images

The dashboard template cards show the top of each template's board as an image, in light and
in dark: `apps/ui/public/images/dashboards/templates/{light,dark}/<templateId>.webp`. A card
loads only the image for the theme in use, lazily.

The images are drawn by the running app's own widgets. `capture.mjs` opens each template as a
board that exists only in the browser and answers every widget query from `sample-data.mjs`,
at a fixed clock. Nothing is written to the database.

`sample-data.mjs` is preview-only: one fictional online-shop support agent over 30 days, with
an outage on day 19 and a release on day 23, so every widget on a card tells the same story. It
is never seeded or shipped. It names no product and no real company.

## Regenerate

Start the dev stack (`make haven up` or `pnpm dev`), then:

```bash
PREVIEW_EMAIL=you@langwatch.local PREVIEW_PASSWORD=... \
  node dev/scripts/template-previews/capture.mjs            # every id in TEMPLATE_PREVIEW_IDS
node dev/scripts/template-previews/capture.mjs costs data   # only these
```

The session is saved in the OS temp folder and reused, so later runs need no password. Other
settings: `LANGWATCH_URL` (default `http://localhost:5560`), `LANGWATCH_API_URL` (the sign-in
origin, default `http://localhost:6560`) and `PREVIEW_PROJECT` (a project slug to open the
boards in; default the first project you can open).

The script stops with a non-zero exit when:

- a template query has no sample (it names each `template/widget/query`);
- a board draws fewer widgets than its template has;
- a widget shows a failed, empty or setup face instead of its chart.

## When something changes

- **A new captured template:** add its id to `TEMPLATE_PREVIEW_IDS` in
  `modules/analytics/browser/src/features/dashboards/model/template-library.ts`, add samples
  for any query the script names, and run it for that id.
- **A widget's code or query changes:** run the script again and look at the new images in the
  diff. When a query's columns change, update its sample first.
