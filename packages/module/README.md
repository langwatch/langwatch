# @langwatch/module

The light core every module contract imports: the `moduleApi` and supply tokens,
`ModuleName` and `FEATURE_NAMES` (generated from `modules/catalogue.json`),
the tRPC contract builder, UI tokens and release flags. It has no server, no
tRPC runtime and no Node API in its value-import graph, so a browser can import
it. Heavy composition (`createApp`, the installer, eventing) stays in
`@langwatch/kernel`, which does not re-export anything from here.
