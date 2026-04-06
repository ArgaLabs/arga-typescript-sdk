# Examples

These examples are meant to look like small scripts a customer could adapt for a
release checklist, a QA handoff, or a staging workflow. They are not generic
CLI demos.

In your own application code, use:

```ts
import { Arga } from "arga-sdk";
```

The in-repo examples import from `../src/index.js` so they can run directly
from this repository without building and publishing first.

## Prerequisites

Use Node 18 or newer, then install dev dependencies from the repository root:

```bash
npm install
```

Set your API key before running any live example:

```bash
export ARGA_API_KEY=arga_your_api_key
```

If you need a non-default environment, set:

```bash
export ARGA_BASE_URL=https://app.argalabs.com
```

## How To Use These Examples

Each example has a small config block near the top of the file. Before you run
one, open the file and edit that config to match your environment and flow.

Then run it from the repo root with `tsx`:

```bash
npx tsx examples/validate_staging_release.ts
```

## Start Here

Start with `validate_staging_release.ts` if you are new to the SDK. It is the
best first example because it matches a common customer question: “Can I gate a
release on a staging validation run?”

## Customer Workflows

### How do I validate staging before a release?

Use [`validate_staging_release.ts`](validate_staging_release.ts).

Before running it, edit the `releaseValidation` config block near the top of
the file so it points at your staging or RC URL and the flow you actually care
about.

```bash
npx tsx examples/validate_staging_release.ts
```

What it does:

- creates a URL validation run against staging
- waits for Arga to finish
- prints a concise release-gate summary
- exits non-zero if the run does not finish cleanly

### How do I create a reusable checkout scenario?

Use [`create_checkout_scenario.ts`](create_checkout_scenario.ts).

Before running it, edit the `checkoutScenario` config block so the prompt,
tags, and seed data match your product.

```bash
npx tsx examples/create_checkout_scenario.ts
```

What it does:

- creates a reusable scenario for a business-critical checkout flow
- stores realistic seed data and scenario metadata
- prints the created scenario ID so your team can reuse it later

### How do I provision disposable dependencies like Stripe?

Use [`provision_checkout_twins.ts`](provision_checkout_twins.ts).

Before running it, edit the `twinSetup` config block to match the integrations
your app depends on.

```bash
npx tsx examples/provision_checkout_twins.ts
```

What it does:

- provisions disposable twins for external dependencies
- waits until those twins are ready
- prints dashboard URLs, endpoints, and env vars in a copyable shape

### How do I let Arga explore staging autonomously?

Use [`explore_staging_with_agent.ts`](explore_staging_with_agent.ts).

Before running it, edit the `agentRun` config block so the objective matches
what your team wants explored on staging.

```bash
npx tsx examples/explore_staging_with_agent.ts
```

What it does:

- launches an autonomous agent run against staging
- waits for the run to finish
- prints the high-signal artifacts you would review before acting on the build

## Validation

The repo already typechecks examples separately and includes a smoke test that
imports them without executing live API calls:

```bash
npm run examples:check
npm run test
```
