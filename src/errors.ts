/**
 * Base error class for all Arga SDK errors.
 */
export class ArgaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArgaError";
  }
}

/**
 * Thrown when the Arga API returns a non-2xx response.
 */
export class ArgaAPIError extends ArgaError {
  /** HTTP status code returned by the API. */
  readonly statusCode: number;
  /** Raw Response object from fetch. */
  readonly response: Response;
  /** Parsed response body, if available. */
  readonly body: unknown;

  constructor(
    message: string,
    statusCode: number,
    response: Response,
    body?: unknown,
  ) {
    super(message);
    this.name = "ArgaAPIError";
    this.statusCode = statusCode;
    this.response = response;
    this.body = body;
  }
}
