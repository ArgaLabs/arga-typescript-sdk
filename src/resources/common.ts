import { ArgaError } from "../errors.js";
import type { WaitOptions } from "../types.js";

export function segment(id: string): string {
  if (typeof id !== "string" || !id || id === "." || id === "..")
    throw new ArgaError("Supply a nonempty resource identifier");
  return encodeURIComponent(id);
}
export function artifactPath(path: string): string {
  if (
    typeof path !== "string" ||
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((p) => p === "." || p === "..")
  )
    throw new ArgaError("Supply an artifact path within the run");
  return path.split("/").map(encodeURIComponent).join("/");
}
export async function poll<T extends { status: string }>(
  get: () => Promise<T>,
  terminal: Set<string>,
  options: WaitOptions = {},
): Promise<T> {
  const interval = options.pollInterval ?? 2500,
    timeout = options.timeout ?? 600000;
  if (![interval, timeout].every((v) => Number.isFinite(v) && v > 0))
    throw new ArgaError(
      "Polling interval and timeout must be finite and positive",
    );
  const deadline = performance.now() + timeout;
  while (true) {
    const value = await get();
    if (terminal.has(value.status)) return value;
    const remaining = deadline - performance.now();
    if (remaining <= 0)
      throw new ArgaError(
        `Timed out waiting for run after ${timeout}ms (last status: ${value.status})`,
      );
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(interval, remaining)),
    );
  }
}
