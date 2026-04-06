import { pathToFileURL } from "node:url";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Set ${name} before running this example. See examples/README.md for setup details.`,
    );
  }

  return value;
}

export function printJson(title: string, value: unknown): void {
  console.log(`\n${title}`);
  console.log(JSON.stringify(value, null, 2));
}

export function isMain(importMetaUrl: string): boolean {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint) && importMetaUrl === pathToFileURL(entrypoint).href;
}

export function handleFatalError(error: unknown): never {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }

  process.exit(1);
}
