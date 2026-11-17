# Live SDK acceptance test

`e2e.mjs` is an explicit opt-in test using synthetic fixtures. It requires a full
Arga credential in `ARGA_API_KEY` or the existing local Arga CLI profile, and a
Braintrust credential in `BRAINTRUST_API_KEY`. Its macOS fallback reads the
temporary `arga-ts-sdk-e2e` CLI profile from Keychain, without printing it.

Use a private directory outside the repository. Never commit its state: it
contains synthetic raw provider data, endpoint references and local alias keys.
Do not use real customer data or production Gmail/Stripe endpoints.

```bash
node scripts/e2e.mjs prepare /private/path/state.json
# Wait until prepare reports ready; it never prints provider credentials.
node scripts/e2e.mjs capture /private/path/state.json
node scripts/e2e.mjs braintrust /private/path/state.json
node scripts/e2e.mjs generate-sdk /private/path/state.json
node scripts/e2e.mjs grade-sdk /private/path/state.json
node scripts/e2e.mjs generate-braintrust /private/path/state.json
node scripts/e2e.mjs grade-braintrust /private/path/state.json
node scripts/e2e.mjs coverage /private/path/state.json
node scripts/e2e.mjs cleanup /private/path/state.json
```

`prepare` saves an exact Scenario fixture and provisions Gmail/Stripe twins.
`capture` calls official provider libraries, then checks the actual outcome and
the privacy of uploaded and stored evidence. It is a one-shot mutation: reset
the run before repeating it. Braintrust fixture writes use the official writer
and an isolated project; the Arga sync itself uses HTTP. Braintrust indexing can
be delayed after a flush; retry the sync phase with the same checkpoint if the
first discovery window sees no roots. The overlap handles late indexed traces.

Generation uses production Training and real model calls. The two tasks remain
drafts. Eight snapshot cases per path run through the API and the downloaded,
hash-verified Python verifier. The incomplete-evidence test must return 422 and
create no task. No emails are sent, no real payments are refunded, and no tasks
are automatically approved.

For package verification, install the npm tarball (or published version) and
the harness's provider/writer dependencies in a separate directory, copy the
harness there and run it against that installation. It imports `arga-sdk` and
`arga-sdk/tracing`, never checkout source files.

Always request teardown in `cleanup`, confirm the source run is `torn_down`, and
delete the source Scenario. Keep the resulting synthetic drafts for review as
needed. Remove temporary CLI/Keychain login profiles after completing the test;
local logout is not server-side credential revocation.
