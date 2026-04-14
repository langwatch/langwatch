---
active: true
iteration: 7
session_id: 
max_iterations: 0
completion_promise: null
started_at: "2026-04-13T22:15:55Z"
---

hey there, we need to migrate our project from next.js to pure vite. We never needed SSR at all and our frontend is so heavy and slow now, slow to build, everything
we recently migrated from nextauth to betterauth so we should be quite decoupled there
a big thing we are still coupled though and major major concern, is all the routing, both in the sense that everything is using next/router or so to navigate, and on the [...paths], and the fact that we have both pages and app router
on APIs, most of it should be hono already, so we can hopefully rewire those up, but some of them, most specially the /collector, we REALLY need to be FUCKING careful, all our traces are comming through there and it's critical it fully works and all tested
other than that, there are a few streamed SSE endpoints I think I'm also concerned about on not breaking
but most most importantly, is the frontend navigation. We have A LOT hooked up with navigations, most specially query strings on the filters (everywhere, traces page, analytics page), analytics itself and custom analytics, autosave navigation on evaluations-v3, and so on, A LOT that can break and go wrong, this is why we need you to load the /orchestrate skill on how we work, and most importantly, the /browser-qa skill (not browser test, not browser pair, REALLY /browser-qa), for after the nextjs migration is done and nextjs is completely ripped off and everything compiles we REALLY need to manually test and retest every single corner, only by clicking the browser manually you will be able to do it, using both claude in chrome and playright to your favor
when understanding everything, you may see some custom webpack aliases or whatever, I think those are no longer needed for a while now, pnpm nicely separates the versions anyway so I think you can just rip off those without worries
we also need to think about everything that changes on build, deployment, on Dockerfile, both here and on ~/Projects/langwatch-saas/infrastructure and the github ci actions in both places should anything change
those are the ones from the top of my mind, but there might be many many more edges and corners that could be a problem on this migration, I want you to keep testing it and looping and iterating and dogfooding it until you find the last bug, everything compiles and run in dev super nicely and renders and navigate all perfect without type errors, runtime errors, nothing
continue iterating, leave no stone unturned
btw langwatch frontend should default to run on port 5560 like before, always, api proxied via 5560
