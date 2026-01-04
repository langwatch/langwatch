# Deja-View (Event Sourcing Debug CLI)

<center>
<img src="./assets/images/deja-view.png" alt="Deja-View" width="600" />
</center>

Interactive Ink CLI for replaying LangWatch event-sourcing projections with step-by-step inspection.

## Usage

```bash
pnpm tool:deja-view
```

## Features

- Auto-discovers projections under `src/server/event-sourcing/pipelines/**/projections`.
- Replays a JSON event array (LangWatch event log shape).
- Lets you select projections and step through events.
