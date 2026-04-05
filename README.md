# Arga TypeScript SDK

TypeScript client for the [Arga](https://argalabs.com) API. Zero runtime dependencies -- uses native `fetch` (Node 18+).

## Installation

```bash
npm install arga
```

## Quick Start

```typescript
import { Arga } from 'arga';

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
import { ArgaAPIError } from 'arga';

try {
  await client.runs.get('nonexistent');
} catch (err) {
  if (err instanceof ArgaAPIError) {
    console.error(err.statusCode); // e.g. 404
    console.error(err.message);    // error detail from API
  }
}
```

## Documentation

Full API documentation is available at [docs.argalabs.com](https://docs.argalabs.com).

## License

MIT
