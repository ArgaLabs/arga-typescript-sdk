import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as root from "arga-sdk";
import * as tracing from "arga-sdk/tracing";
const require = createRequire(import.meta.url),
  cjs = require("arga-sdk"),
  cjsTracing = require("arga-sdk/tracing");
for (const name of [
  "Tracing",
  "CapturePolicy",
  "BraintrustSync",
  "SyncError",
  "Projector",
]) {
  assert.equal(root[name], tracing[name], `ESM ${name} identity`);
  assert.equal(cjs[name], cjsTracing[name], `CommonJS ${name} identity`);
}
assert.equal(typeof root.Arga, "function");
assert.equal(typeof cjs.Arga, "function");
console.log("ESM/CommonJS package exports and class identity passed");
