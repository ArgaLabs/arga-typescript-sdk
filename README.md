# Arga TypeScript SDK

TypeScript client for the [Arga](https://argalabs.com) API. Zero runtime dependencies -- uses native `fetch` (Node 18+).

## Installation

```bash
npm install arga-sdk
```

## Quick Start

```typescript
import { Arga } from 'arga-sdk';

const client = new Arga({ apiKey: 'arga_...' });

// Create a URL run
const run = await client.runs.createUrlRun({
  url: 'https://staging.myapp.com',
  twins: ['stripe', 'slack'],
});
console.log(run.runId, run.status);

// Poll until the run completes
const detail = await client.runs.wait(run.runId);
console.log(detail.status, detail.resultsJson);

// Stream results via SSE
for await (const event of client.runs.streamResults(run.runId)) {
  console.log(event);
}
```

## Configuration

```typescript
const client = new Arga({
  apiKey: 'arga_...', // required
  baseUrl: 'https://app.argalabs.com', // optional, this is the default
});
```

## Examples

Runnable examples live in [`examples/`](examples/README.md). They are the best
way to see realistic customer workflows end to end.

If you want to run the in-repo examples from a local checkout:

```bash
npm install
export ARGA_API_KEY=arga_your_api_key
```

If you need a non-default environment, you can also set:

```bash
export ARGA_BASE_URL=https://app.argalabs.com
```

Start with the staging validation example:

```bash
npx tsx examples/validate_staging_release.ts
```

Each example is a small workflow script with an editable config block near the
top of the file. Open the file, adjust the business-specific values, then run
it with `tsx`.

Choose an example based on the customer job you want to model:

- [`examples/validate_staging_release.ts`](examples/validate_staging_release.ts): validate staging before a release
- [`examples/create_checkout_scenario.ts`](examples/create_checkout_scenario.ts): create a reusable checkout scenario
- [`examples/provision_checkout_twins.ts`](examples/provision_checkout_twins.ts): provision disposable integrations like Stripe
- [`examples/explore_staging_with_agent.ts`](examples/explore_staging_with_agent.ts): let Arga explore staging autonomously

See [`examples/README.md`](examples/README.md) for exact commands, required
edits, and expected output for each example.

## Available Methods

### Runs

| Method | Description |
|--------|-------------|
| `client.runs.createUrlRun(params)` | Create a URL validation run |
| `client.runs.createPrRun(params)` | Create a PR validation run |
| `client.runs.createAgentRun(params)` | Create an autonomous agent run |
| `client.runs.get(runId)` | Get full run details |
| `client.runs.streamResults(runId)` | Stream run results as SSE events |
| `client.runs.cancel(runId)` | Cancel a running run |
| `client.runs.wait(runId, opts?)` | Poll until terminal status |

### Twins

| Method | Description |
|--------|-------------|
| `client.twins.list()` | List all available twins |
| `client.twins.provision(params)` | Provision twins for a run |
| `client.twins.getStatus(runId)` | Get twin provisioning status |
| `client.twins.extend(runId, params?)` | Extend twin TTL |

### Scenarios

| Method | Description |
|--------|-------------|
| `client.scenarios.create(params)` | Create a new scenario |
| `client.scenarios.list(params?)` | List scenarios (filter by twin or tag) |
| `client.scenarios.get(scenarioId)` | Get a scenario by ID |

## Error Handling

```typescript
import { ArgaAPIError, ArgaError } from 'arga-sdk';

try {
  await client.runs.get('nonexistent');
} catch (err) {
  if (err instanceof ArgaAPIError) {
    console.error(err.statusCode); // e.g. 404
    console.error(err.message);    // error detail from API
    console.error(err.body);       // parsed response body, when available
  } else if (err instanceof ArgaError) {
    console.error(err.message);    // e.g. wait() timeout
  }
}
```

## Documentation

Full API documentation is available at [docs.argalabs.com](https://docs.argalabs.com).

## License

MIT
