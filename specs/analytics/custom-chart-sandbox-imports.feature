Feature: Custom chart widgets import any module and run under their own CSP
  As a dashboard author writing a custom chart widget
  I want to import any npm package or URL in my widget
  So that my chart can use the libraries I already know, without an allow list

  # ---------------------------------------------------------------------------
  # A srcdoc iframe inherits the parent page's Content-Security-Policy, so the
  # app-wide policy decided what the sandbox could load and blocked its React,
  # Recharts and Babel bundles in production. The frame document now lives on
  # its own route with its own policy: any https origin may serve scripts,
  # styles, fonts, images and fetches to the frame. The frame keeps
  # sandbox="allow-scripts" with no allow-same-origin, so it stays an opaque
  # origin with no cookies and no parent DOM. Widget source travels over the
  # existing lw:init postMessage instead of being baked into the document.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The frame document is served on its own route with its own policy
    Given the app serves the chart frame document at "/sandbox/chart-frame"
    When the frame document's response headers are built
    Then its Content-Security-Policy script-src allows any https origin, blob: and data:
    And its Content-Security-Policy style-src, font-src, img-src and connect-src allow any https origin
    And its Content-Security-Policy frame-ancestors is 'self'
    And its X-Frame-Options is SAMEORIGIN
    And the response is never cached

  @unit
  Scenario: The frame's own inline scripts survive a nonce added upstream
    Given the frame route issues a fresh nonce on every response
    When the frame document and its policy are built
    Then the policy's script-src carries that nonce and no 'unsafe-inline'
    And every inline script in the document, including the import map, carries the same nonce

  @unit
  Scenario: The frame document is sandboxed even when opened directly
    Given the app serves the chart frame document at "/sandbox/chart-frame"
    When the frame document's response headers are built
    Then its Content-Security-Policy carries a sandbox allow-scripts directive
    And so the document runs at an opaque origin however it is loaded, not only when embedded

  @unit
  Scenario: The frame ignores init messages that do not come from its parent
    Given the frame's shim is listening for lw:init
    When an lw:init message arrives whose source is not the frame's parent window
    Then the widget source is not published and the author runtime is not activated
    But an lw:init message whose source is the parent window is accepted

  @unit
  Scenario: The app's own policy is unchanged by the sandbox
    When the app's production security headers are built
    Then its Content-Security-Policy script-src does not list unpkg.com or esm.sh

  @unit
  Scenario: The frame document carries no widget source
    When the chart frame document is built
    Then it contains the React, ReactDOM, Recharts and Babel script tags
    And it contains the shim, charts library and author runtime scripts
    And it contains no widget source

  @unit
  Scenario: A bare package import resolves to esm.sh with React externalised
    When a widget imports "dayjs"
    Then the specifier resolves to "https://esm.sh/dayjs?external=react,react-dom"

  @unit
  Scenario: A scoped or deep package import resolves to esm.sh unchanged
    When a widget imports "@tanstack/react-table" or "lodash-es/debounce"
    Then the specifier resolves to the same path under "https://esm.sh/" with React externalised

  @unit
  Scenario: Built-in modules resolve to the frame's own instance
    When a widget imports "react", "react-dom", "react-dom/client", "recharts" or "@langwatch/charts"
    Then the specifier is left unchanged so the import map serves the frame's UMD global

  @unit
  Scenario: A package built with the automatic JSX runtime shares the frame's React
    Given a third-party package imports "react/jsx-runtime"
    When the frame resolves it
    Then it resolves to the frame's own React instance through the import map
    And it is not rewritten to esm.sh

  @unit
  Scenario: The JSX runtime shim preserves array children exactly
    Given a third-party package compiled with the automatic JSX runtime renders a component with children
    When it passes an empty array, a single-element array or a multi-element array as children
    Then the component receives the same array shape React would give it
    And a key passed as the third argument becomes the element key, not a prop

  @unit
  Scenario: URL, data, blob and relative imports are left alone
    When a widget imports "https://esm.sh/canvas-confetti", "data:text/javascript,...", "blob:..." or "./helper"
    Then the specifier is left unchanged

  @unit
  Scenario: An http module URL is rejected with a clear compile error
    When a widget imports "http://example.com/lib.js"
    Then the compile fails with an error containing "Module URLs must use https"

  @unit
  Scenario: A widget's dynamic import of a bare package is rewritten too
    When a widget calls import("dayjs") lazily
    Then the bare specifier is rewritten to the CDN URL like a static import
    And a dynamic import with a non-literal argument is left unchanged

  @unit
  Scenario: A widget exporting a memoized or forwardRef component mounts
    When a widget exports React.memo or React.forwardRef
    Then the component mounts successfully
    And the error panel does not display "No default export"

  @integration
  Scenario: The bridge listens for the frame before navigating it
    Given a chart frame is mounted
    When the bridge attaches to it
    Then the load listener is installed before the frame is navigated
    So a fast load can never miss lw:init

  @integration
  Scenario: The parent delivers the widget source on init
    Given a sandboxed chart frame is mounted with widget source
    When the frame document loads
    Then the parent posts exactly one lw:init carrying the widget source, dashboard context and params

  @integration
  Scenario: The frame reloads when the widget code changes
    Given a sandboxed chart frame is mounted
    When the widget source changes
    Then the iframe is remounted and a fresh lw:init carries the new source

  # Tracking: https://github.com/langwatch/langwatch/issues/8152
  @integration @unimplemented
  Scenario: A widget importing a third-party package renders under enforced headers
    Given the app is running with enforced production security headers
    And a widget imports a package from npm that is not bundled with the app
    When the widget is placed on a dashboard
    Then the chart renders and the browser console shows no CSP violation
