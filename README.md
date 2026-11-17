# Arga TypeScript SDK

Node.js 18+ client for Arga, with current backend APIs, customer-side Gmail/Stripe tracing, Braintrust sync and Training in **v0.2.0**. ESM and CommonJS are supported. Tracing is included in the normal install; collection starts only when you configure it.

```bash
npm install arga-sdk@^0.2.0
```

## Current APIs

```typescript
import { Arga } from 'arga-sdk';

const arga = new Arga({ apiKey: process.env.ARGA_API_KEY! });
const run = await arga.twinRuns.create({ twins: ['gmail', 'stripe'] });
const ready = await arga.twinRuns.wait(run.runId);
console.log(ready.status);
```

The default origin is `https://api.argalabs.com`. Set `baseUrl` for another environment. Request timeouts default to 300,000 milliseconds. Treat provider `envVars`, proxy tokens and artifact URLs as secrets; do not print them.

| Resource | Supported workflow |
| --- | --- |
| `twinRuns` | Create, inspect, wait, reset, extend, lock, tear down and Microsoft Scenario snapshot |
| `twins` | Service catalog; older provisioning calls remain for compatibility |
| `testRuns` | Create, list, inspect, wait, rerun, edit TestConfig, send messages and get artifact URLs |
| `tests` | Create, list, inspect, edit, delete and run Saved Tests |
| `scenarios` | Create, list, edit, delete, copy, presets and persistent environments |
| `training` | Source-bound upload keys, evidence, task generation/edit/review, graders, environments and JSONL |

Model properties use camelCase. Customer-owned JSON (`seedConfig`, `testConfig`, `testConfigJson`, `spec`, snapshots and provider `envVars`) retains its exact keys. This corrects older recursive key conversion that could change provider data. Legacy `runs` helpers remain available; new browser testing uses `testRuns` and `tests`.

## Customer-side tracing

Mint a source-bound upload key outside the agent using a full Arga credential:

```typescript
const credential = await arga.training.createUploadKey({ source: 'support-agent' });
const secret = credential.key.getSecretValue();
// Store secret in your secret manager as ARGA_TRACE_KEY. Never print it.
```

Wrap your application's existing provider clients and use an explicit episode:

```typescript
import { Tracing, CapturePolicy } from 'arga-sdk/tracing';

const tracing = new Tracing({
  source: 'support-agent',
  policy: new CapturePolicy({
    textFields: ['goal', 'policy'],
    transformText: filterTrainingText, // Your synchronous customer-local filter.
    revision: 'support-1',
  }),
});
const stripe = tracing.wrapStripe(stripeClient);
const gmail = tracing.wrapGmail(gmailClient);
await tracing.episode({
  goal: 'Resolve the duplicate payment while preserving the original.',
  policies: ['Customer confirmations require owner review before sending.'],
}, async () => {
  // Await your existing agent code using stripe and gmail here.
});
await tracing.flush(10000);
console.log(tracing.diagnostics(), tracing.recentUploads());
await tracing.close();
```

Define `filterTrainingText` and supply your existing `stripeClient` and Gmail `gmailClient`. Adapters support the official Stripe client and Gmail clients from `googleapis` or `@googleapis/gmail`; provider libraries stay in your application's dependencies. Only executed wrapped calls are observed. No module patches, provider credential inspection or extra provider requests occur.

Free text is excluded by default. Select `goal`, `policy`, `gmail.subject` and `gmail.body` explicitly as needed, and filter selected text locally. Built-in masking supplements your policy; it is not a complete personal-data filter. IDs and email addresses are aliased per episode. Source code, arbitrary metadata, system prompts/reasoning, raw MIME, attachments, HTML and snippets are excluded. Missing state is unknown. Overlapping mutations and detected unsupported operations block generation through coverage issues.

Use `upload: false` to inspect `lastEpisode` locally. Export contains at most 100 events, 50 records/event and 100,000 bytes. The in-memory queue is bounded and attempts delivery at most three times. A drained queue does not prove delivery: inspect uploaded/failed/dropped counters. No disk spool is provided. Manual list-page iteration is supported; Stripe automatic pagination helpers retain their behavior but mark incomplete coverage.

## Braintrust sync

Run the worker on customer infrastructure. `BRAINTRUST_API_KEY` stays there; only projected evidence goes to Arga under `ARGA_TRACE_KEY`.

```bash
npx arga-braintrust-sync --project PROJECT_UUID --source support-agent \
  --since 2026-11-17T00:00:00Z --state ./private/braintrust-ts.json \
  --policy ./trace-policy.json --watch
```

Policy JSON accepts `text_fields`, `revision`, `goal_pointer`, `policies` and a tool-name-to-canonical-name `operations` map. Free text remains opt-in. Canonical executed tools use provider-shaped input/output; LLM suggestions and root output are excluded. For custom text filters, use `BraintrustSync` programmatically with `CapturePolicy`.

The worker processes bounded windows with overlap, pagination, replay digests and pending roots. Checkpoints are atomic and mode 0600 on POSIX; they store aliases/references/digests, not raw spans or credentials. Locks are exclusive and never stolen automatically; after a crash verify the old process has stopped before removing its stale `.lock`. Python and TypeScript checkpoint formats are separate. No Braintrust writer SDK is needed for sync.

## Training

```typescript
const dataset = await arga.training.get('DATASET_UUID');
const task = await arga.training.generateTask(dataset.id, { traceId: dataset.traces[0].id });
const bundle = await arga.training.getGrader(dataset.id, task.id);
```

Generated tasks remain drafts. Review starting state, scoring, provenance, assumptions and the compiled grader before acknowledging and approving the current revision. Verifiers are portable Python snapshot programs, also testable through `training.testGrader`. The SDK does not automatically collect verifier snapshots or run agents/model training. Missing required evidence blocks generation; selected evidence remains in existing private Training storage and is sent to the configured model provider when you request generation.

## Validation

```bash
npm ci
npm run typecheck
npm run examples:check
npm test
npm run build
npm audit --omit=dev
```

The opt-in `scripts/e2e.mjs` harness exercises official Gmail/Stripe clients against isolated twins, live Braintrust sync, production Training generation and eight verifier scenarios through the API and portable artifact. It uses synthetic fixtures only and saves private local state. See `scripts/README.md` for execution and cleanup.

## Documentation

- [Current APIs](https://docs.argalabs.com/sdks/typescript)
- [Tracing and filtering](https://docs.argalabs.com/sdks/typescript/tracing)
- [Braintrust sync](https://docs.argalabs.com/sdks/typescript/braintrust)
- [Tasks and verifiers](https://docs.argalabs.com/sdks/typescript/training)
