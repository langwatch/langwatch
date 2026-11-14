# Implementation:
#   apps/ui/src/ui.entrypoint.tsx
#   apps/ui/src/styles/globals.scss
#   packages/design-system/src/components/brand/langy-theme.css
#   modules/auth/browser/src/ui/elements/auth-front-door.css

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

  @unit
  Scenario: Every vendored cut of the display face is declared document-wide
    Given the display face files vendored in apps/ui/public/fonts
    When the global stylesheet is read
    Then it declares a face for each of those files
    And a heading asking for a bold weight is drawn from a real cut rather
      than a synthesised one

  @unit
  Scenario: A stylesheet's font files load from wherever the stylesheet is served
    Given the hosted product serves the built stylesheets from the asset CDN
    And the CDN serves the built assets folder and nothing else
    When the browser stylesheets are read
    Then every font url is relative, so the build emits the file beside the stylesheet
    And only the global stylesheet declares the display face, so no feature
      stylesheet overrides it with another url
