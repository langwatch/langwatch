# Image spend dogfood probe

Proves that an image call through the AI gateway is metered and billed: the
image tokens reach the spend record, the budget moves, and the trace explorer
shows the call without the image payload.

## Prerequisites

- The local stack is up: the app on `:5560` and the gateway on `:5563`.
- `OPENAI_API_KEY` is set in `platform/app/.env`.
- `DATABASE_URL` points at the local Postgres. Both scripts refuse a remote
  host unless you pass `--allow-remote-db`.

## How to run

Seed the provider and the org-default routing policy once:

```bash
pnpm tsx scripts/dogfood/images/seed-images-vk.ts --email admin@haven.localhost
```

Then run the probe:

```bash
pnpm tsx scripts/dogfood/images/probe-image-spend.ts --email admin@haven.localhost
```

The probe refuses to start when `gateway_spend` does not carry the image
quantity columns of migration 00089. It issues its own virtual key and its own
budget, so the spend it measures is its own. It writes the two images it made
to `out/`, which is git ignored.

## Flags

| Flag | Scripts | Default | Meaning |
| --- | --- | --- | --- |
| `--email <address>` | both | required | The user whose org is used |
| `--org <id or name>` | both | - | Required when the user is in several orgs |
| `--gateway <url>` | probe | `$LW_GATEWAY_BASE_URL` or `http://localhost:5563` | Gateway base URL |
| `--model <id>` | probe | `gpt-image-2` | Image model to call |
| `--quality <level>` | probe | `low` | Image quality, `low` keeps the run cheap |
| `--deadline-ms <ms>` | probe | `60000` | How long each poll may wait |
| `--allow-remote-db` | both | off | Opt out of the local-database guard |
| `--force-keys` | seeder | off | Replace a provider credential that is already stored |

## What it asserts

Two calls, a generation and an edit of the image the generation returned:

1. `POST /v1/images/generations` returns 200, `data[0].b64_json` decodes to
   bytes that start with the PNG magic, and `usage` reports output image
   tokens above zero.
2. `POST /v1/images/edits` posts that PNG as `image[]`, returns 200, decodes
   to a PNG, and reports both input and output image tokens above zero.

Then, polling to the deadline for each read:

- `gateway_spend` holds a row for each gateway request id, with
  `TokensOutputImage` above zero on both and `TokensInputImage` above zero on
  the edit.
- Each row is priced above zero nano-USD.
- The budget ledger holds a positive success debit for each call, and the
  budget total moved by a positive amount.
- The trace explorer states `total_cost` above zero for both traces.
- Each trace carries its image span (`gen_ai.image_generation` and
  `gen_ai.image_edit`), the span input holds the prompt, and the span output
  is under 1 KB and carries no `b64_json`, so the image never reached storage.

The probe prints a table of the spend rows and a PASS or FAIL line per check,
then exits non-zero when any check failed.
