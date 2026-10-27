# Main colour parity

Source: origin/main at `e683dd9ea52c148e7678b1c22202dbfea9f1eb9f`. The production system is
`platform/app/src/pages/_app.tsx`, with scales from
`platform/app/src/components/ui/color-mode.tsx`, layered over Chakra 3.36 defaults.
The branch and main declare the same Chakra dependency. Values below include inherited
Chakra roles: especially bare bg, palette contrast/border and status bg/fg/border.
Current means the working tree at the start of this task, after the palette revert.

All 111 explicit raw scale entries already matched main. No raw hue was changed.
Orange remains #ED8926. The conditional orange.solid representation is retained
to survive feature-theme merging; its resolved light/dark values equal main.

## Semantic tokens

| Token              | Current branch value                              | Main value                          | New value                                   |
| ------------------ | ------------------------------------------------- | ----------------------------------- | ------------------------------------------- |
| bg                 | light: white; dark: black                         | light: white; dark: black           | light: white; dark: black                   |
| bg.subtle          | light: gray.50; dark: zinc.900                    | light: gray.50; dark: zinc.900      | light: gray.50; dark: zinc.900              |
| bg.muted           | light: gray.100; dark: zinc.850                   | light: gray.100; dark: zinc.850     | light: gray.100; dark: zinc.850             |
| bg.emphasized      | light: gray.200; dark: zinc.600                   | light: gray.200; dark: zinc.600     | light: gray.200; dark: zinc.600             |
| bg.inverted        | light: black; dark: white                         | light: black; dark: white           | light: black; dark: white                   |
| bg.panel           | light: white; dark: zinc.800                      | light: white; dark: zinc.800        | light: white; dark: zinc.800                |
| bg.error           | light: red.50; dark: red.900                      | light: red.50; dark: red.950        | light: red.50; dark: red.950                |
| bg.warning         | light: yellow.50; dark: yellow.900                | light: orange.50; dark: orange.950  | light: orange.50; dark: orange.950          |
| bg.success         | light: green.50; dark: green.900                  | light: green.50; dark: green.950    | light: green.50; dark: green.950            |
| bg.info            | light: blue.50; dark: blue.900                    | light: blue.50; dark: blue.950      | light: blue.50; dark: blue.950              |
| bg.card            | light: bg.panel; dark: bg.panel                   | —                                   | bg.panel                                    |
| bg.overlay         | light: bg.panel; dark: bg.panel                   | —                                   | bg.panel                                    |
| bg.nested          | light: bg.muted; dark: bg.muted                   | —                                   | bg.muted                                    |
| bg.raised          | light: bg.muted; dark: bg.muted                   | —                                   | bg.panel                                    |
| bg.control         | light: bg.emphasized; dark: bg.emphasized         | —                                   | bg.input                                    |
| bg.hover           | light: bg.softHover; dark: bg.softHover           | —                                   | bg.softHover                                |
| bg.selected        | light: bg.emphasized; dark: bg.emphasized         | —                                   | nav.bgActive                                |
| bg.stripe          | light: bg.subtle; dark: bg.subtle                 | —                                   | bg.subtle                                   |
| bg.page            | light: gray.100; dark: zinc.900                   | light: gray.100; dark: zinc.900     | light: gray.100; dark: zinc.900             |
| bg.surface         | light: white; dark: zinc.950                      | light: white; dark: zinc.950        | light: white; dark: zinc.950                |
| bg.rail            | light: gray.150; dark: zinc.850                   | light: gray.150; dark: zinc.850     | light: gray.150; dark: zinc.850             |
| bg.softHover       | light: gray.100; dark: zinc.850                   | light: gray.100; dark: zinc.850     | light: gray.100; dark: zinc.850             |
| bg.input           | light: gray.200; dark: zinc.900                   | light: gray.200; dark: zinc.900     | light: gray.200; dark: zinc.900             |
| bg.inputHover      | light: white; dark: zinc.800                      | light: white; dark: zinc.800        | light: white; dark: zinc.800                |
| bg.scrim           | light: blackAlpha.500; dark: blackAlpha.700       | —                                   | light: blackAlpha.500; dark: blackAlpha.700 |
| fg                 | light: gray.900; dark: gray.100                   | light: gray.900; dark: gray.100     | light: gray.900; dark: gray.100             |
| fg.muted           | light: gray.600; dark: gray.300                   | light: gray.600; dark: gray.300     | light: gray.600; dark: gray.300             |
| fg.subtle          | light: gray.500; dark: gray.400                   | light: gray.500; dark: gray.400     | light: gray.500; dark: gray.400             |
| fg.inverted        | light: white; dark: gray.950                      | light: white; dark: gray.950        | light: white; dark: gray.950                |
| fg.error           | light: red.600; dark: red.300                     | light: red.500; dark: red.400       | light: red.500; dark: red.400               |
| fg.warning         | light: yellow.600; dark: yellow.300               | light: orange.600; dark: orange.300 | light: orange.600; dark: orange.300         |
| fg.success         | light: green.600; dark: green.300                 | light: green.600; dark: green.300   | light: green.600; dark: green.300           |
| fg.info            | light: blue.600; dark: blue.300                   | light: blue.600; dark: blue.300     | light: blue.600; dark: blue.300             |
| border             | light: gray.200; dark: zinc.600                   | light: gray.200; dark: zinc.600     | light: gray.200; dark: zinc.600             |
| border.muted       | light: gray.100; dark: zinc.700                   | light: gray.100; dark: zinc.700     | light: gray.100; dark: zinc.700             |
| border.subtle      | light: gray.100; dark: zinc.800                   | light: gray.100; dark: zinc.800     | light: gray.100; dark: zinc.800             |
| border.emphasized  | light: gray.300; dark: zinc.500                   | light: gray.300; dark: zinc.500     | light: gray.300; dark: zinc.500             |
| border.inverted    | light: gray.800; dark: gray.200                   | light: gray.800; dark: gray.200     | light: gray.800; dark: gray.200             |
| border.error       | light: red.300; dark: red.700                     | light: red.500; dark: red.400       | light: red.500; dark: red.400               |
| border.warning     | light: yellow.300; dark: yellow.700               | light: orange.500; dark: orange.400 | light: orange.500; dark: orange.400         |
| border.success     | light: green.300; dark: green.700                 | light: green.500; dark: green.400   | light: green.500; dark: green.400           |
| border.info        | light: blue.300; dark: blue.700                   | light: blue.500; dark: blue.400     | light: blue.500; dark: blue.400             |
| border.card        | light: border; dark: border                       | —                                   | border                                      |
| border.nested      | light: border.muted; dark: border.muted           | —                                   | border.muted                                |
| border.control     | light: border; dark: border                       | —                                   | border                                      |
| border.strong      | light: border.emphasized; dark: border.emphasized | —                                   | border.emphasized                           |
| gray.contrast      | light: gray.800; dark: gray.100                   | light: gray.800; dark: gray.100     | light: gray.800; dark: gray.100             |
| gray.fg            | light: gray.700; dark: gray.200                   | light: gray.700; dark: gray.200     | light: gray.700; dark: gray.200             |
| gray.subtle        | light: gray.50; dark: zinc.800                    | light: gray.50; dark: zinc.800      | light: gray.50; dark: zinc.800              |
| gray.muted         | light: gray.100; dark: zinc.700                   | light: gray.100; dark: zinc.700     | light: gray.100; dark: zinc.700             |
| gray.emphasized    | light: gray.400; dark: zinc.600                   | light: gray.400; dark: zinc.600     | light: gray.400; dark: zinc.600             |
| gray.solid         | light: gray.200; dark: zinc.700                   | light: gray.200; dark: zinc.700     | light: gray.200; dark: zinc.700             |
| gray.focusRing     | blue.500                                          | rgb(49, 130, 206)                   | rgb(49, 130, 206)                           |
| gray.border        | light: gray.200; dark: gray.800                   | light: gray.200; dark: gray.800     | light: gray.200; dark: gray.800             |
| gray.hover         | light: gray.300; dark: zinc.600                   | light: gray.300; dark: zinc.600     | light: gray.300; dark: zinc.600             |
| red.contrast       | light: white; dark: white                         | light: white; dark: white           | light: white; dark: white                   |
| red.fg             | light: red.700; dark: red.200                     | light: red.700; dark: red.200       | light: red.700; dark: red.200               |
| red.subtle         | light: red.50; dark: red.900                      | light: red.50; dark: red.900        | light: red.50; dark: red.900                |
| red.muted          | light: red.100; dark: red.800                     | light: red.100; dark: red.800       | light: red.100; dark: red.800               |
| red.emphasized     | light: red.400; dark: red.700                     | light: red.400; dark: red.700       | light: red.400; dark: red.700               |
| red.solid          | light: red.500; dark: red.400                     | light: red.500; dark: red.400       | light: red.500; dark: red.400               |
| red.focusRing      | blue.500                                          | rgb(49, 130, 206)                   | rgb(49, 130, 206)                           |
| red.border         | light: red.500; dark: red.400                     | light: red.500; dark: red.400       | light: red.500; dark: red.400               |
| red.hover          | light: red.600; dark: red.500                     | light: red.600; dark: red.500       | light: red.600; dark: red.500               |
| orange.contrast    | light: white; dark: black                         | light: white; dark: black           | light: white; dark: black                   |
| orange.fg          | light: orange.800; dark: orange.200               | light: orange.800; dark: orange.200 | light: orange.800; dark: orange.200         |
| orange.subtle      | light: orange.100; dark: orange.900               | light: orange.100; dark: orange.900 | light: orange.100; dark: orange.900         |
| orange.muted       | light: orange.100; dark: orange.800               | light: orange.100; dark: orange.800 | light: orange.100; dark: orange.800         |
| orange.emphasized  | light: orange.400; dark: orange.700               | light: orange.400; dark: orange.700 | light: orange.400; dark: orange.700         |
| orange.solid       | light: #ED8926; dark: #ED8926                     | #ED8926                             | light: #ED8926; dark: #ED8926               |
| orange.focusRing   | blue.500                                          | rgb(49, 130, 206)                   | rgb(49, 130, 206)                           |
| orange.border      | light: orange.500; dark: orange.400               | light: orange.500; dark: orange.400 | light: orange.500; dark: orange.400         |
| orange.hover       | light: orange.600; dark: orange.500               | light: orange.600; dark: orange.500 | light: orange.600; dark: orange.500         |
| green.contrast     | light: white; dark: white                         | light: white; dark: white           | light: white; dark: white                   |
| green.fg           | light: green.700; dark: green.200                 | light: green.700; dark: green.200   | light: green.700; dark: green.200           |
| green.subtle       | light: green.50; dark: green.900                  | light: green.50; dark: green.900    | light: green.50; dark: green.900            |
| green.muted        | light: green.100; dark: green.800                 | light: green.100; dark: green.800   | light: green.100; dark: green.800           |
| green.emphasized   | light: green.400; dark: green.700                 | light: green.400; dark: green.700   | light: green.400; dark: green.700           |
| green.solid        | light: green.500; dark: green.400                 | light: green.500; dark: green.400   | light: green.500; dark: green.400           |
| green.focusRing    | blue.500                                          | rgb(49, 130, 206)                   | rgb(49, 130, 206)                           |
| green.border       | light: green.500; dark: green.400                 | light: green.500; dark: green.400   | light: green.500; dark: green.400           |
| green.hover        | light: green.600; dark: green.500                 | light: green.600; dark: green.500   | light: green.600; dark: green.500           |
| blue.contrast      | light: white; dark: white                         | light: white; dark: white           | light: white; dark: white                   |
| blue.fg            | light: blue.700; dark: blue.300                   | light: blue.700; dark: blue.300     | light: blue.700; dark: blue.300             |
| blue.subtle        | light: blue.50; dark: blue.900                    | light: blue.50; dark: blue.900      | light: blue.50; dark: blue.900              |
| blue.muted         | light: blue.100; dark: blue.800                   | light: blue.100; dark: blue.800     | light: blue.100; dark: blue.800             |
| blue.emphasized    | light: blue.400; dark: blue.600                   | light: blue.400; dark: blue.600     | light: blue.400; dark: blue.600             |
| blue.solid         | light: blue.500; dark: blue.500                   | light: blue.500; dark: blue.500     | light: blue.500; dark: blue.500             |
| blue.focusRing     | blue.500                                          | rgb(49, 130, 206)                   | rgb(49, 130, 206)                           |
| blue.border        | light: blue.500; dark: blue.400                   | light: blue.500; dark: blue.400     | light: blue.500; dark: blue.400             |
| blue.hover         | light: blue.600; dark: blue.400                   | light: blue.600; dark: blue.400     | light: blue.600; dark: blue.400             |
| yellow.contrast    | light: black; dark: black                         | light: black; dark: black           | light: black; dark: black                   |
| yellow.fg          | light: yellow.700; dark: yellow.200               | light: yellow.700; dark: yellow.200 | light: yellow.700; dark: yellow.200         |
| yellow.subtle      | light: yellow.50; dark: yellow.900                | light: yellow.50; dark: yellow.900  | light: yellow.50; dark: yellow.900          |
| yellow.muted       | light: yellow.100; dark: yellow.800               | light: yellow.100; dark: yellow.800 | light: yellow.100; dark: yellow.800         |
| yellow.emphasized  | light: yellow.500; dark: yellow.700               | light: yellow.500; dark: yellow.700 | light: yellow.500; dark: yellow.700         |
| yellow.solid       | light: yellow.500; dark: yellow.400               | light: yellow.500; dark: yellow.400 | light: yellow.500; dark: yellow.400         |
| yellow.focusRing   | blue.500                                          | rgb(49, 130, 206)                   | rgb(49, 130, 206)                           |
| yellow.border      | light: yellow.500; dark: yellow.500               | light: yellow.500; dark: yellow.500 | light: yellow.500; dark: yellow.500         |
| yellow.hover       | light: yellow.600; dark: yellow.500               | light: yellow.600; dark: yellow.500 | light: yellow.600; dark: yellow.500         |
| teal.contrast      | light: white; dark: white                         | light: white; dark: white           | light: white; dark: white                   |
| teal.fg            | light: teal.700; dark: teal.200                   | light: teal.700; dark: teal.200     | light: teal.700; dark: teal.200             |
| teal.subtle        | light: teal.50; dark: teal.900                    | light: teal.50; dark: teal.900      | light: teal.50; dark: teal.900              |
| teal.muted         | light: teal.100; dark: teal.800                   | light: teal.100; dark: teal.800     | light: teal.100; dark: teal.800             |
| teal.emphasized    | light: teal.500; dark: teal.700                   | light: teal.500; dark: teal.700     | light: teal.500; dark: teal.700             |
| teal.solid         | light: teal.500; dark: teal.400                   | light: teal.500; dark: teal.400     | light: teal.500; dark: teal.400             |
| teal.focusRing     | blue.500                                          | rgb(49, 130, 206)                   | rgb(49, 130, 206)                           |
| teal.border        | light: teal.500; dark: teal.400                   | light: teal.500; dark: teal.400     | light: teal.500; dark: teal.400             |
| teal.hover         | light: teal.600; dark: teal.500                   | light: teal.600; dark: teal.500     | light: teal.600; dark: teal.500             |
| purple.contrast    | light: white; dark: white                         | light: white; dark: white           | light: white; dark: white                   |
| purple.fg          | light: purple.700; dark: purple.200               | light: purple.700; dark: purple.200 | light: purple.700; dark: purple.200         |
| purple.subtle      | light: purple.50; dark: purple.900                | light: purple.50; dark: purple.900  | light: purple.50; dark: purple.900          |
| purple.muted       | light: purple.100; dark: purple.800               | light: purple.100; dark: purple.800 | light: purple.100; dark: purple.800         |
| purple.emphasized  | light: purple.400; dark: purple.700               | light: purple.400; dark: purple.700 | light: purple.400; dark: purple.700         |
| purple.solid       | light: purple.500; dark: purple.400               | light: purple.500; dark: purple.400 | light: purple.500; dark: purple.400         |
| purple.focusRing   | blue.500                                          | rgb(49, 130, 206)                   | rgb(49, 130, 206)                           |
| purple.border      | light: purple.500; dark: purple.400               | light: purple.500; dark: purple.400 | light: purple.500; dark: purple.400         |
| purple.hover       | light: purple.600; dark: purple.500               | light: purple.600; dark: purple.500 | light: purple.600; dark: purple.500         |
| pink.contrast      | light: white; dark: white                         | light: white; dark: white           | light: white; dark: white                   |
| pink.fg            | light: pink.700; dark: pink.200                   | light: pink.700; dark: pink.200     | light: pink.700; dark: pink.200             |
| pink.subtle        | light: pink.50; dark: pink.900                    | light: pink.50; dark: pink.900      | light: pink.50; dark: pink.900              |
| pink.muted         | light: pink.100; dark: pink.800                   | light: pink.100; dark: pink.800     | light: pink.100; dark: pink.800             |
| pink.emphasized    | light: pink.500; dark: pink.700                   | light: pink.500; dark: pink.700     | light: pink.500; dark: pink.700             |
| pink.solid         | light: pink.500; dark: pink.400                   | light: pink.500; dark: pink.400     | light: pink.500; dark: pink.400             |
| pink.focusRing     | blue.500                                          | rgb(49, 130, 206)                   | rgb(49, 130, 206)                           |
| pink.border        | light: pink.500; dark: pink.400                   | light: pink.500; dark: pink.400     | light: pink.500; dark: pink.400             |
| pink.hover         | light: pink.600; dark: pink.500                   | light: pink.600; dark: pink.500     | light: pink.600; dark: pink.500             |
| cyan.contrast      | light: white; dark: white                         | light: white; dark: white           | light: white; dark: white                   |
| cyan.fg            | light: cyan.700; dark: cyan.200                   | light: cyan.700; dark: cyan.200     | light: cyan.700; dark: cyan.200             |
| cyan.subtle        | light: cyan.50; dark: cyan.900                    | light: cyan.50; dark: cyan.900      | light: cyan.50; dark: cyan.900              |
| cyan.muted         | light: cyan.100; dark: cyan.800                   | light: cyan.100; dark: cyan.800     | light: cyan.100; dark: cyan.800             |
| cyan.emphasized    | light: cyan.500; dark: cyan.700                   | light: cyan.500; dark: cyan.700     | light: cyan.500; dark: cyan.700             |
| cyan.solid         | light: cyan.500; dark: cyan.400                   | light: cyan.500; dark: cyan.400     | light: cyan.500; dark: cyan.400             |
| cyan.focusRing     | blue.500                                          | rgb(49, 130, 206)                   | rgb(49, 130, 206)                           |
| cyan.border        | light: cyan.500; dark: cyan.400                   | light: cyan.500; dark: cyan.400     | light: cyan.500; dark: cyan.400             |
| cyan.hover         | light: cyan.600; dark: cyan.500                   | light: cyan.600; dark: cyan.500     | light: cyan.600; dark: cyan.500             |
| accent.solid       | orange.solid                                      | —                                   | orange.solid                                |
| accent.contrast    | orange.contrast                                   | —                                   | orange.contrast                             |
| accent.fg          | orange.fg                                         | —                                   | orange.fg                                   |
| accent.muted       | orange.muted                                      | —                                   | orange.muted                                |
| accent.subtle      | orange.subtle                                     | —                                   | orange.subtle                               |
| accent.emphasized  | orange.emphasized                                 | —                                   | orange.emphasized                           |
| accent.hover       | orange.hover                                      | —                                   | orange.hover                                |
| accent.focusRing   | orange.focusRing                                  | —                                   | orange.focusRing                            |
| logo.mark          | light: #213B41; dark: gray.100                    | —                                   | light: #213B41; dark: gray.100              |
| logo.face          | light: white; dark: transparent                   | —                                   | light: white; dark: transparent             |
| logo.wordmark      | light: #1D293D; dark: gray.100                    | —                                   | light: #1D293D; dark: gray.100              |
| logo.wordmarkMuted | light: #314158; dark: gray.300                    | —                                   | light: #314158; dark: gray.300              |
| chart.1            | light: orange.500; dark: orange.300               | —                                   | light: orange.500; dark: orange.300         |
| chart.2            | light: blue.500; dark: blue.300                   | —                                   | light: blue.500; dark: blue.300             |
| chart.3            | light: green.500; dark: green.300                 | —                                   | light: green.500; dark: green.300           |
| chart.4            | light: yellow.500; dark: yellow.300               | —                                   | light: yellow.500; dark: yellow.300         |
| chart.5            | light: purple.500; dark: purple.300               | —                                   | light: purple.500; dark: purple.300         |
| chart.6            | light: teal.500; dark: teal.300                   | —                                   | light: teal.500; dark: teal.300             |
| chart.7            | light: cyan.500; dark: cyan.300                   | —                                   | light: cyan.500; dark: cyan.300             |
| chart.8            | light: pink.500; dark: pink.300                   | —                                   | light: pink.500; dark: pink.300             |
| status.success     | light: green.400; dark: green.400                 | light: green.400; dark: green.400   | light: green.400; dark: green.400           |
| status.error       | light: red.400; dark: red.400                     | light: red.400; dark: red.400       | light: red.400; dark: red.400               |
| status.warning     | light: yellow.500; dark: yellow.400               | light: yellow.500; dark: yellow.400 | light: yellow.500; dark: yellow.400         |
| status.pending     | light: yellow.500; dark: yellow.400               | light: yellow.500; dark: yellow.400 | light: yellow.500; dark: yellow.400         |
| status.info        | light: blue.400; dark: blue.400                   | light: blue.400; dark: blue.400     | light: blue.400; dark: blue.400             |
| nav.marker         | light: gray.500; dark: gray.400                   | —                                   | fg.subtle                                   |
| nav.fg             | light: gray.700; dark: gray.300                   | light: gray.700; dark: gray.300     | light: gray.700; dark: gray.300             |
| nav.fgMuted        | light: gray.600; dark: gray.400                   | light: gray.600; dark: gray.400     | light: gray.600; dark: gray.400             |
| nav.bgActive       | light: gray.200; dark: zinc.700                   | light: gray.200; dark: zinc.700     | light: gray.200; dark: zinc.700             |
| nav.bgHover        | light: gray.200; dark: zinc.800                   | light: gray.200; dark: zinc.800     | light: gray.200; dark: zinc.800             |
| label.fg           | light: gray.600; dark: gray.400                   | light: gray.600; dark: gray.400     | light: gray.600; dark: gray.400             |
| label.fgMuted      | light: gray.500; dark: gray.500                   | light: gray.500; dark: gray.500     | light: gray.500; dark: gray.500             |

## Raw scales (both modes)

| Token          | Current branch value      | Main value                | New value                 |
| -------------- | ------------------------- | ------------------------- | ------------------------- |
| transparent    | transparent               | transparent               | transparent               |
| current        | currentColor              | currentColor              | currentColor              |
| black          | #09090B                   | #09090B                   | #09090B                   |
| white          | #FFFFFF                   | #FFFFFF                   | #FFFFFF                   |
| whiteAlpha.50  | rgba(255, 255, 255, 0.04) | rgba(255, 255, 255, 0.04) | rgba(255, 255, 255, 0.04) |
| whiteAlpha.100 | rgba(255, 255, 255, 0.06) | rgba(255, 255, 255, 0.06) | rgba(255, 255, 255, 0.06) |
| whiteAlpha.200 | rgba(255, 255, 255, 0.08) | rgba(255, 255, 255, 0.08) | rgba(255, 255, 255, 0.08) |
| whiteAlpha.300 | rgba(255, 255, 255, 0.16) | rgba(255, 255, 255, 0.16) | rgba(255, 255, 255, 0.16) |
| whiteAlpha.400 | rgba(255, 255, 255, 0.24) | rgba(255, 255, 255, 0.24) | rgba(255, 255, 255, 0.24) |
| whiteAlpha.500 | rgba(255, 255, 255, 0.36) | rgba(255, 255, 255, 0.36) | rgba(255, 255, 255, 0.36) |
| whiteAlpha.600 | rgba(255, 255, 255, 0.48) | rgba(255, 255, 255, 0.48) | rgba(255, 255, 255, 0.48) |
| whiteAlpha.700 | rgba(255, 255, 255, 0.64) | rgba(255, 255, 255, 0.64) | rgba(255, 255, 255, 0.64) |
| whiteAlpha.800 | rgba(255, 255, 255, 0.80) | rgba(255, 255, 255, 0.80) | rgba(255, 255, 255, 0.80) |
| whiteAlpha.900 | rgba(255, 255, 255, 0.92) | rgba(255, 255, 255, 0.92) | rgba(255, 255, 255, 0.92) |
| whiteAlpha.950 | rgba(255, 255, 255, 0.95) | rgba(255, 255, 255, 0.95) | rgba(255, 255, 255, 0.95) |
| blackAlpha.50  | rgba(0, 0, 0, 0.04)       | rgba(0, 0, 0, 0.04)       | rgba(0, 0, 0, 0.04)       |
| blackAlpha.100 | rgba(0, 0, 0, 0.06)       | rgba(0, 0, 0, 0.06)       | rgba(0, 0, 0, 0.06)       |
| blackAlpha.200 | rgba(0, 0, 0, 0.08)       | rgba(0, 0, 0, 0.08)       | rgba(0, 0, 0, 0.08)       |
| blackAlpha.300 | rgba(0, 0, 0, 0.16)       | rgba(0, 0, 0, 0.16)       | rgba(0, 0, 0, 0.16)       |
| blackAlpha.400 | rgba(0, 0, 0, 0.24)       | rgba(0, 0, 0, 0.24)       | rgba(0, 0, 0, 0.24)       |
| blackAlpha.500 | rgba(0, 0, 0, 0.36)       | rgba(0, 0, 0, 0.36)       | rgba(0, 0, 0, 0.36)       |
| blackAlpha.600 | rgba(0, 0, 0, 0.48)       | rgba(0, 0, 0, 0.48)       | rgba(0, 0, 0, 0.48)       |
| blackAlpha.700 | rgba(0, 0, 0, 0.64)       | rgba(0, 0, 0, 0.64)       | rgba(0, 0, 0, 0.64)       |
| blackAlpha.800 | rgba(0, 0, 0, 0.80)       | rgba(0, 0, 0, 0.80)       | rgba(0, 0, 0, 0.80)       |
| blackAlpha.900 | rgba(0, 0, 0, 0.92)       | rgba(0, 0, 0, 0.92)       | rgba(0, 0, 0, 0.92)       |
| blackAlpha.950 | rgba(0, 0, 0, 0.95)       | rgba(0, 0, 0, 0.95)       | rgba(0, 0, 0, 0.95)       |
| gray.50        | #f8fafc                   | #f8fafc                   | #f8fafc                   |
| gray.100       | #f1f5f9                   | #f1f5f9                   | #f1f5f9                   |
| gray.150       | #e7ecf2                   | #e7ecf2                   | #e7ecf2                   |
| gray.200       | #e2e8f0                   | #e2e8f0                   | #e2e8f0                   |
| gray.300       | #cbd5e1                   | #cbd5e1                   | #cbd5e1                   |
| gray.400       | #9CA3AF                   | #9CA3AF                   | #9CA3AF                   |
| gray.450       | #7B8394                   | #7B8394                   | #7B8394                   |
| gray.500       | #5c5c6e                   | #5c5c6e                   | #5c5c6e                   |
| gray.600       | #3d3d4d                   | #3d3d4d                   | #3d3d4d                   |
| gray.700       | #2d2d3d                   | #2d2d3d                   | #2d2d3d                   |
| gray.800       | #1a1a2e                   | #1a1a2e                   | #1a1a2e                   |
| gray.900       | #111113                   | #111113                   | #111113                   |
| gray.950       | #09090b                   | #09090b                   | #09090b                   |
| red.50         | #FFF5F5                   | #FFF5F5                   | #FFF5F5                   |
| red.100        | #FED7D7                   | #FED7D7                   | #FED7D7                   |
| red.200        | #FEB2B2                   | #FEB2B2                   | #FEB2B2                   |
| red.300        | #FC8181                   | #FC8181                   | #FC8181                   |
| red.400        | #F56565                   | #F56565                   | #F56565                   |
| red.500        | #E53E3E                   | #E53E3E                   | #E53E3E                   |
| red.600        | #C53030                   | #C53030                   | #C53030                   |
| red.700        | #9B2C2C                   | #9B2C2C                   | #9B2C2C                   |
| red.800        | #822727                   | #822727                   | #822727                   |
| red.900        | #63171B                   | #63171B                   | #63171B                   |
| red.950        | #1f0808                   | #1f0808                   | #1f0808                   |
| orange.50      | #FFFAF0                   | #FFFAF0                   | #FFFAF0                   |
| orange.100     | #FFF3E4                   | #FFF3E4                   | #FFF3E4                   |
| orange.200     | #FFD19B                   | #FFD19B                   | #FFD19B                   |
| orange.300     | #FF9E2C                   | #FF9E2C                   | #FF9E2C                   |
| orange.400     | #ED8926                   | #ED8926                   | #ED8926                   |
| orange.500     | #ED8926                   | #ED8926                   | #ED8926                   |
| orange.600     | #dd6b20                   | #dd6b20                   | #dd6b20                   |
| orange.700     | #c05621                   | #c05621                   | #c05621                   |
| orange.800     | #7B341E                   | #7B341E                   | #7B341E                   |
| orange.900     | #652B19                   | #652B19                   | #652B19                   |
| orange.950     | #220a04                   | #220a04                   | #220a04                   |
| yellow.50      | #FFFFF0                   | #FFFFF0                   | #FFFFF0                   |
| yellow.100     | #FEFCBF                   | #FEFCBF                   | #FEFCBF                   |
| yellow.200     | #FAF089                   | #FAF089                   | #FAF089                   |
| yellow.300     | #F6E05E                   | #F6E05E                   | #F6E05E                   |
| yellow.400     | #ECC94B                   | #ECC94B                   | #ECC94B                   |
| yellow.500     | #D69E2E                   | #D69E2E                   | #D69E2E                   |
| yellow.600     | #B7791F                   | #B7791F                   | #B7791F                   |
| yellow.700     | #975A16                   | #975A16                   | #975A16                   |
| yellow.800     | #744210                   | #744210                   | #744210                   |
| yellow.900     | #5F370E                   | #5F370E                   | #5F370E                   |
| yellow.950     | #281304                   | #281304                   | #281304                   |
| green.50       | #F0FFF4                   | #F0FFF4                   | #F0FFF4                   |
| green.100      | #C6F6D5                   | #C6F6D5                   | #C6F6D5                   |
| green.200      | #9AE6B4                   | #9AE6B4                   | #9AE6B4                   |
| green.300      | #68D391                   | #68D391                   | #68D391                   |
| green.400      | #48BB78                   | #48BB78                   | #48BB78                   |
| green.500      | #38A169                   | #38A169                   | #38A169                   |
| green.600      | #2F855A                   | #2F855A                   | #2F855A                   |
| green.700      | #276749                   | #276749                   | #276749                   |
| green.800      | #22543D                   | #22543D                   | #22543D                   |
| green.900      | #1C4532                   | #1C4532                   | #1C4532                   |
| green.950      | #03190c                   | #03190c                   | #03190c                   |
| teal.50        | #E6FFFA                   | #E6FFFA                   | #E6FFFA                   |
| teal.100       | #B2F5EA                   | #B2F5EA                   | #B2F5EA                   |
| teal.200       | #81E6D9                   | #81E6D9                   | #81E6D9                   |
| teal.300       | #4FD1C5                   | #4FD1C5                   | #4FD1C5                   |
| teal.400       | #38B2AC                   | #38B2AC                   | #38B2AC                   |
| teal.500       | #319795                   | #319795                   | #319795                   |
| teal.600       | #2C7A7B                   | #2C7A7B                   | #2C7A7B                   |
| teal.700       | #285E61                   | #285E61                   | #285E61                   |
| teal.800       | #234E52                   | #234E52                   | #234E52                   |
| teal.900       | #1D4044                   | #1D4044                   | #1D4044                   |
| teal.950       | #021716                   | #021716                   | #021716                   |
| blue.50        | #ebf8ff                   | #ebf8ff                   | #ebf8ff                   |
| blue.100       | #bee3f8                   | #bee3f8                   | #bee3f8                   |
| blue.200       | #90cdf4                   | #90cdf4                   | #90cdf4                   |
| blue.300       | #63b3ed                   | #63b3ed                   | #63b3ed                   |
| blue.400       | #4299e1                   | #4299e1                   | #4299e1                   |
| blue.500       | #3182ce                   | #3182ce                   | #3182ce                   |
| blue.600       | #2b6cb0                   | #2b6cb0                   | #2b6cb0                   |
| blue.700       | #2c5282                   | #2c5282                   | #2c5282                   |
| blue.800       | #2a4365                   | #2a4365                   | #2a4365                   |
| blue.900       | #1A365D                   | #1A365D                   | #1A365D                   |
| blue.950       | #0c142e                   | #0c142e                   | #0c142e                   |
| cyan.50        | #EDFDFD                   | #EDFDFD                   | #EDFDFD                   |
| cyan.100       | #C4F1F9                   | #C4F1F9                   | #C4F1F9                   |
| cyan.200       | #9DECF9                   | #9DECF9                   | #9DECF9                   |
| cyan.300       | #76E4F7                   | #76E4F7                   | #76E4F7                   |
| cyan.400       | #0BC5EA                   | #0BC5EA                   | #0BC5EA                   |
| cyan.500       | #00B5D8                   | #00B5D8                   | #00B5D8                   |
| cyan.600       | #00A3C4                   | #00A3C4                   | #00A3C4                   |
| cyan.700       | #0987A0                   | #0987A0                   | #0987A0                   |
| cyan.800       | #086F83                   | #086F83                   | #086F83                   |
| cyan.900       | #065666                   | #065666                   | #065666                   |
| cyan.950       | #051b24                   | #051b24                   | #051b24                   |
| purple.50      | #FAF5FF                   | #FAF5FF                   | #FAF5FF                   |
| purple.100     | #E9D8FD                   | #E9D8FD                   | #E9D8FD                   |
| purple.200     | #D6BCFA                   | #D6BCFA                   | #D6BCFA                   |
| purple.300     | #B794F4                   | #B794F4                   | #B794F4                   |
| purple.400     | #9F7AEA                   | #9F7AEA                   | #9F7AEA                   |
| purple.500     | #805AD5                   | #805AD5                   | #805AD5                   |
| purple.600     | #6B46C1                   | #6B46C1                   | #6B46C1                   |
| purple.700     | #553C9A                   | #553C9A                   | #553C9A                   |
| purple.800     | #44337A                   | #44337A                   | #44337A                   |
| purple.900     | #322659                   | #322659                   | #322659                   |
| purple.950     | #1a032e                   | #1a032e                   | #1a032e                   |
| pink.50        | #FFF5F7                   | #FFF5F7                   | #FFF5F7                   |
| pink.100       | #FED7E2                   | #FED7E2                   | #FED7E2                   |
| pink.200       | #FBB6CE                   | #FBB6CE                   | #FBB6CE                   |
| pink.300       | #F687B3                   | #F687B3                   | #F687B3                   |
| pink.400       | #ED64A6                   | #ED64A6                   | #ED64A6                   |
| pink.500       | #D53F8C                   | #D53F8C                   | #D53F8C                   |
| pink.600       | #B83280                   | #B83280                   | #B83280                   |
| pink.700       | #97266D                   | #97266D                   | #97266D                   |
| pink.800       | #702459                   | #702459                   | #702459                   |
| pink.900       | #521B41                   | #521B41                   | #521B41                   |
| pink.950       | #2c0514                   | #2c0514                   | #2c0514                   |
| zinc.500       | #565664                   | #565664                   | #565664                   |
| zinc.600       | #3a3a44                   | #3a3a44                   | #3a3a44                   |
| zinc.700       | #282832                   | #282832                   | #282832                   |
| zinc.750       | #20202a                   | #20202a                   | #20202a                   |
| zinc.800       | #1a1a24                   | #1a1a24                   | #1a1a24                   |
| zinc.850       | #15151e                   | #15151e                   | #15151e                   |
| zinc.900       | #10101a                   | #10101a                   | #10101a                   |
| zinc.950       | #080812                   | #080812                   | #080812                   |

## Branch-only roles

- `bg.card` → `bg.panel`.
- `bg.overlay` → `bg.panel`.
- `bg.nested` → `bg.muted`.
- `bg.raised` → `bg.panel`.
- `bg.control` → `bg.input`.
- `bg.hover` → `bg.softHover`.
- `bg.selected` → `nav.bgActive`.
- `bg.stripe` → `bg.subtle`.
- `nav.marker` → `fg.subtle`.
- `border.card` → `border`.
- `border.nested` → `border.muted`.
- `border.control` → `border`.
- `border.strong` → `border.emphasized`.

Controls use main’s sunken input role; raised panels use panel. Selection uses
main’s navigation selection, while hover follows softHover. Card/control edges
use the default border; nested edges use muted. The marker uses subtle text.

The accent palette aliases orange. Chart series retain the existing mode-specific
500/300 steps from main’s ramps. Logo colours retain their explicit brand identity
(main has no logo token group); scrim retains blackAlpha.500/700. These are
branch-only roles, not a new neutral palette. Main already defines fg.subtle,
bg.softHover, bg.emphasized and nav.{fg,fgMuted,bgActive,bgHover}.

## Feature-specific main themes

Main also composes authThemeConfig and langyThemeConfig. Auth uses its own brand
ramp (#ffb380, #ff8a3d, #f56b1a, #c2510a, #a83e05) and ink
(#141417, #0a0a0c) under auth.*. Langy uses the same ink and the first
three brand steps, white-alpha elevation, moss (#5b7a4a/#7fa06a) and rust
(#b85240/#d6796a), scoped by _langy/_langyDark. These are feature themes,
not global app ramps; copying them globally would recolour the rest of the app.
They remain with their feature owners and are outside this edit scope.

## Contrast and visual comparison

Main is the parity target, not a new contrast proposal. Its faint structural
borders do not promise 3:1, and every status/subtle text pairing does not promise
4.5:1. Tests preserve primary/secondary text contrast on normal surfaces and
check all captured main values, rather than asserting invented elevation gaps.
The requested screenshots show the mapped palette on the branch layout. Main
was not booted: no branch switch or worktree was made. Matching colour tokens
does not imply identical layouts or recipes.

## Main feature token inventory (not global aliases)

These scoped production colours are recorded for comparison only. No feature code
is imported into the design system or edited. Auth brand/ink are local constants,
not exported raw Chakra ramps. Langy has no light override for global roles.

| Namespace / token      | Main value / conditions                                                |
| ---------------------- | ---------------------------------------------------------------------- |
| auth.ground            | _light: #ffffff; _dark: #0a0a0c                                        |
| auth.action            | _light: #141417; _dark: #f5f4f1                                        |
| auth.actionHover       | _light: #2c2c31; _dark: #e2e0da                                        |
| auth.onAction          | _light: #ffffff; _dark: #0a0a0c                                        |
| auth.ink               | _light: #a83e05; _dark: #ff8a3d                                        |
| auth.tint              | _light: #fdece0; _dark: rgba(245, 107, 26, 0.18)                       |
| auth.hairline          | _light: rgba(20, 20, 23, 0.12); _dark: rgba(239, 238, 233, 0.14)       |
| auth.danger            | _light: #c53030; _dark: #e08573                                        |
| auth.detail            | _light: #f56b1a; _dark: rgba(255, 138, 61, 0.75)                       |
| auth.badge             | _light: #c2510a; _dark: #c2510a                                        |
| auth.focusRing         | _light: rgba(245, 107, 26, 0.22); _dark: rgba(255, 138, 61, 0.22)      |
| auth.glow              | _light: rgba(245, 107, 26, 0.28); _dark: rgba(255, 138, 61, 0.22)      |
| auth.cardBg            | _light: rgba(255, 255, 255, 0.3); _dark: rgba(10, 10, 12, 0.54)        |
| auth.cardBgSolid       | _light: rgba(255, 255, 255, 0.85); _dark: rgba(12, 12, 15, 0.88)       |
| auth.cardBorder        | _light: rgba(20, 20, 23, 0.09); _dark: rgba(255, 255, 255, 0.1)        |
| auth.fieldBg           | _light: rgba(255, 255, 255, 0.62); _dark: rgba(255, 255, 255, 0.06)    |
| auth.fieldBorder       | _light: rgba(20, 20, 23, 0.14); _dark: rgba(255, 255, 255, 0.14)       |
| bg.surface             | _langyDark: #141417                                                    |
| bg.panel               | _langyDark: #0a0a0c                                                    |
| bg.page                | _langyDark: #0a0a0c                                                    |
| bg.subtle              | _langyDark: rgba(255, 255, 255, 0.03)                                  |
| bg.muted               | _langyDark: rgba(255, 255, 255, 0.06)                                  |
| bg.emphasized          | _langyDark: rgba(255, 255, 255, 0.1)                                   |
| fg                     | _langyDark: #ffffff                                                    |
| fg.muted               | _langyDark: rgba(255, 255, 255, 0.55)                                  |
| fg.subtle              | _langyDark: rgba(255, 255, 255, 0.35)                                  |
| border                 | _langyDark: rgba(255, 255, 255, 0.1)                                   |
| border.muted           | _langyDark: rgba(255, 255, 255, 0.1)                                   |
| border.emphasized      | _langyDark: rgba(255, 255, 255, 0.15)                                  |
| orange.solid           | _langyDark: #ff8a3d                                                    |
| orange.fg              | _langyDark: #ffb380                                                    |
| orange.emphasized      | _langyDark: rgba(255, 179, 128, 0.3)                                   |
| orange.subtle          | _langyDark: rgba(255, 179, 128, 0.1)                                   |
| orange.muted           | _langyDark: rgba(255, 179, 128, 0.16)                                  |
| purple.solid           | _langyDark: #a855f7                                                    |
| purple.fg              | _langyDark: #a855f7                                                    |
| purple.emphasized      | _langyDark: rgba(168, 85, 247, 0.3)                                    |
| purple.subtle          | _langyDark: rgba(168, 85, 247, 0.1)                                    |
| purple.muted           | _langyDark: rgba(168, 85, 247, 0.16)                                   |
| green.fg               | _langyDark: #7fa06a                                                    |
| green.solid            | _langyDark: #5b7a4a                                                    |
| red.fg                 | _langyDark: #d6796a                                                    |
| red.solid              | _langyDark: #b85240                                                    |
| langy.aiBlue           | _langy: #5b8def; _langyDark: #5fa3ff                                   |
| langy.aiPurple         | _langy: #a855f7; _langyDark: #a855f7                                   |
| langy.aiOrange         | _langy: #f56b1a; _langyDark: #ff8a3d                                   |
| langy.barTrack         | _langy: #e2e2e2; _langyDark: rgba(255, 255, 255, 0.1)                  |
| langy.barFill          | _langy: rgba(245, 107, 26, 0.75); _langyDark: rgba(255, 179, 128, 0.7) |
| langy.grid             | _langy: transparent; _langyDark: rgba(255, 255, 255, 0.035)            |
| langy.answerFg         | _langy: #363530; _langyDark: rgba(255, 255, 255, 0.87)                 |
| langy.userBubbleBg     | _langy: #e2e8f0; _langyDark: rgba(255, 255, 255, 0.06)                 |
| langy.userBubbleBorder | _langy: #cbd5e1; _langyDark: rgba(255, 255, 255, 0.1)                  |

`colorPalette.*` is Chakra’s virtual palette: selecting `colorPalette="orange"`
redirects solid, contrast, fg, subtle, muted, emphasized, focusRing and border
to orange’s roles (hover is the app extension). The effective values are in
the semantic table. `colorPalette="accent"` follows the branch’s orange aliases.

## Validation

- Oxfmt and type-aware Oxc passed on changed source/tests; git diff --check passed.
- Focused Vitest: 212 tests passed in raw-color-value, semantic-colour-contrast,
  system and alert-recipe suites.
- Test-quality review passed.
- The broader run completed: 1,596 passed, four failed (79 files). It started
  before the neutral-alert correction; that failure now passes in the focused
  run. Three remaining failures are outside the colour edits:
  - branded-card-responsive expects narrow 408px; the component uses 400px.
  - storybook-showcase finds missing usage metadata in
    src/components/states/access-state.stories.tsx.
  - no-raw-error-toasts reports packages/browser-host/src/isolated-error-boundary.tsx:87,
    modules/experiment/browser/src/ui/sections/experiments-v3/TargetSection/target-cell.tsx:116
    and :131, modules/trace/browser/src/ui/sections/explorer/trace-drawer/trace-accordions/span-accordions.tsx:551,
    and modules/trace/browser/src/ui/sections/isolated-error-boundary.tsx:84.
- Architecture lint (--no-declarations; no package typecheck) reported 28
  existing findings in eight policies. None names a file edited for this task:

```
[feature-layout] enterprise/modules/enterprise-gateway/contract/src/enterprise-gateway.api.ts
  A portable feature API may bind only the feature-API vocabulary from @langwatch/module; it binds Named.
[feature-layout] enterprise/modules/managed-provider/contract/src/managed-provider.api.ts
  A portable feature API may bind only the feature-API vocabulary from @langwatch/module; it binds Named.
[feature-layout] enterprise/modules/saas/contract/src/saas.api.ts
  A portable feature API may bind only the feature-API vocabulary from @langwatch/module; it binds Named.
[feature-layout] modules/api-key/contract/src/api-key.api.ts
  A portable feature API may bind only the feature-API vocabulary from @langwatch/module; it binds Named.
[feature-layout] modules/auth/contract/src/auth.api.ts
  A portable feature API may bind only the feature-API vocabulary from @langwatch/module; it binds Named.
[feature-layout] modules/rum/contract/src/rum.api.ts
  A portable feature API may bind only the feature-API vocabulary from @langwatch/module; it binds Named.
[feature-layout] modules/sample-agents/contract/src/sample-agents.api.ts
  A portable feature API may bind only the feature-API vocabulary from @langwatch/module; it binds Named.
[deleted-spellings-in-code] modules/annotation/browser/src/ui/sections/annotation-queue-editor.tsx:184 (noMembers)
  `noMembers` is deleted (ARCHITECTURE.md §15, §3.3, §5): an existing use is conversion debt and a new one is a defect.
[deleted-spellings-in-code] modules/annotation/browser/src/ui/sections/annotation-queue-editor.tsx:245 (noMembers)
  `noMembers` is deleted (ARCHITECTURE.md §15, §3.3, §5): an existing use is conversion debt and a new one is a defect.
[deleted-spellings-in-code] modules/annotation/browser/src/ui/sections/annotation-queue-editor.tsx:252 (noMembers)
  `noMembers` is deleted (ARCHITECTURE.md §15, §3.3, §5): an existing use is conversion debt and a new one is a defect.
[deleted-spellings-in-code] modules/annotation/browser/src/ui/sections/annotation-queue-editor.tsx:253 (noMembers)
  `noMembers` is deleted (ARCHITECTURE.md §15, §3.3, §5): an existing use is conversion debt and a new one is a defect.
[deleted-spellings-in-code] modules/annotation/browser/src/ui/sections/annotation-queue-editor.tsx:295 (noMembers)
  `noMembers` is deleted (ARCHITECTURE.md §15, §3.3, §5): an existing use is conversion debt and a new one is a defect.
[deleted-spellings-in-code] modules/feature-flag/client/src/use-feature-flag.ts (per-module `use-feature-flag.ts` copies)
  per-module `use-feature-flag.ts` copies is deleted (ARCHITECTURE.md §15, §3.4, §10.1): an existing use is conversion debt and a new one is a defect.
[service-ceilings] modules/auth/process/src/services/api-door.service.ts
  Service module exceeds its ceiling (lines 552/500, longest method 39/80, statements 7/24, complexity 8/24, line length 100/160).
[service-ceilings] modules/auth/process/src/services/browser-session.service.ts
  Service module exceeds its ceiling (lines 501/500, longest method 44/80, statements 10/24, complexity 14/24, line length 105/160).
[service-ceilings] modules/ops/process/src/features/metrics/services/ops-metrics-collector.service.ts
  Service module exceeds its ceiling (lines 510/500, longest method 59/80, statements 16/24, complexity 7/24, line length 116/160).
[service-ceilings] modules/scenario/process/src/features/child/services/node-scenario-child.service.ts
  Service module exceeds its ceiling (lines 502/500, longest method 66/80, statements 14/24, complexity 7/24, line length 102/160).
[source-folder-shape] enterprise/modules/licensing/browser/src/ui/sections/global-upgrade-modal/lite-member-restriction-content.tsx
  `lite-member-restriction-content.tsx` is 14 lines and only `global-upgrade-modal.tsx` reads it, all in the same folder, so it is a paragraph of that file, not a module.
[source-folder-shape] modules/auth/process/src/services
  `modules/auth/process/src/services` holds 31 source files; a folder is one concept, and past 30 files a reader stops seeing it. Before adding a file here, name the file that already owns this noun and put the code there.
[source-folder-shape] packages/design-system/src/system/section-navigation.recipe.ts
  `section-navigation.recipe.ts` is 17 lines and only `config.ts` reads it, all in the same folder, so it is a paragraph of that file, not a module.
[source-folder-shape] packages/otlp/src/path-canonicalisation.ts
  `path-canonicalisation.ts` is 6 lines and exists only to be re-exported by the folder's index; nothing in this folder reads it, so it has no home here.
[lint-rule-skill-pointers] packages/oxlint-rules/src/rules/contract-schema-named.rule.mjs (langwatch/contract-schema-named)
  `langwatch/contract-schema-named` names no skill, so an agent that trips it has nowhere to learn the shape it wants.
[lint-rule-skill-pointers] packages/oxlint-rules/src/rules/skip-tenant-check-reason.rule.mjs (langwatch/skip-tenant-check-reason)
  `langwatch/skip-tenant-check-reason` names no skill, so an agent that trips it has nowhere to learn the shape it wants.
[prisma-table-ownership] modules/user/process/src/repositories/prisma/prisma.user-data-erase.repository.ts:275
  user writes Project, which project shares with it for reading only.
[prisma-table-ownership] modules/user/process/src/repositories/prisma/prisma.user-data-erase.repository.ts:280
  user writes Team, which organization shares with it for reading only.
[unused-module-export] modules/organization/process/src/rules/audit-origin.rules.ts
  `audit-origin.rules.ts` exports `AuditOrigin` and no file in the repository imports it, not even the package's own index. An export nothing reads is a name the next author has to rule out before touching this file.
[unused-module-export] modules/scenario/process/src/features/voice/services/voice-public-url.service.ts
  `voice-public-url.service.ts` exports `VoicePublicUrlSource` and no file in the repository imports it, not even the package's own index. An export nothing reads is a name the next author has to rule out before touching this file.
[teaching-citations] .claude/skills/dev-runtime/SKILL.md:31 (path:apps/ui/dist/client.dev)
  This page cites path `apps/ui/dist/client.dev`, which is not a file or folder in the repository; an agent following it will look for something that is gone.
```

## Screenshots

Ten final light/dark captures are indexed in
[.claude/tmp/astra-maincolours](../../../.claude/tmp/astra-maincolours/README.md).
These use the rebuilt fixdrive app without injected CSS. The stale haven
orb's global Chakra theme initially obscured the new palette; hiding the orb
for this tab and refreshing exposed the actual rebuilt tokens. No orb source
was edited. The existing studio workflow shows a connection/run-error state;
no workflow was edited or executed. Main itself was not booted.
