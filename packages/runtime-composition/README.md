# Runtime Composition

`@langwatch/runtime-composition` holds `ResourceScope`, the ordered-ownership
primitive each process composition root uses to register resources as it
starts them and close them once, in reverse order, on shutdown. `apps/api`
and `apps/worker` each build one `ResourceScope` in their runtime and own
their infrastructure through it.
