# Implementation:
#   apps/ui/src/ui.entrypoint.tsx
#   apps/ui/src/styles/globals.scss

Feature: The browser entry loads the shared global stylesheet
  `platform/app`'s `main.tsx` imported `styles/globals.scss`, which carries
  the Inter `@font-face` import, the CSS reset (link underlines,
  box-sizing) and every other global rule the design-system theme does not
  own. The port to `apps/ui` carried the stylesheet itself but not the
  import, so fonts never loaded and links, box-sizing and a handful of
  other resets never applied anywhere in the SPA.

  @unit
  Scenario: The entrypoint imports the global stylesheet
    Given the browser entry module apps/ui/src/ui.entrypoint.tsx
    When its import statements are read
    Then it imports ./styles/globals.scss
