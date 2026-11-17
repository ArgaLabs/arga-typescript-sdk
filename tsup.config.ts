import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/tracing/index.ts", "src/tracing/cli.ts"],
  format: ["esm", "cjs"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
});
