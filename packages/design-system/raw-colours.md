# Browser colour literals

`tests/browser-raw-colours.unit.test.ts` rejects new raw colour literals in production
`apps/ui/src`, `modules/*/browser/src` and `enterprise/modules/*/browser/src` sources.
The adoption collector uses the same Oxc scan and exact-path policy. Both include untracked files.
Tests, fixtures and stories are excluded; comments and RGB strings generated from runtime
colours are not literals. Hex, RGB, HSL and numeric modern CSS colour functions are checked.

Use semantic tokens for styling. Canvas and other libraries needing resolved strings use
`getRawColorValue` or `useColorRawValue` from the design system's `color-mode` entry.
Governance SVG attributes already use semantic CSS variables; analytics, Mermaid and the
not-found canvas already resolve their token colours before generating RGB strings.

`raw-colour-allowlist.json` records the reason for each exception: trademark artwork,
Langy identity palettes, terminal vendor marks, the Konami novelty image and sample payloads.
An exception applies only to that exact file, never its directory. New exceptions require
an explicit reason there. Python, DSPy, TypeScript and Azure SVGs live once in the design
system's `icons` entry; their original brand pigments are intentionally fixed.

`terminal.*` aliases the terminal's previous semantic roles in both modes. The first 16
ANSI indices stay named until rendering; extended colour cube, grayscale and truecolour
payloads remain absolute. Terminal startup logos keep their vendor colours in
`ai-brand-palette.ts`. `illustration.*` retains the exact sun, cloud, ink and SDK-icon
pigments: no existing role matches those colours in both modes. Existing tokens are
unchanged and remain covered by the production-main fixture.
