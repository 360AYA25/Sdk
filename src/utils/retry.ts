/**
 * Retry Utility
 * Handles retry logic for MCP calls and other operations
 */

export interface RetryOptions {
  maxAttempts: number;
  delayMs: number;
  backoffMultiplier?: number;
  onRetry?: (attempt: number, error: Error) => void;
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const {
    maxAttempts,
    delayMs,
    backoffMultiplier = 2,
    onRetry,
  } = options;

  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt < maxAttempts) {
        const delay = delayMs * Math.pow(backoffMultiplier, attempt - 1);

        if (onRetry) {
          onRetry(attempt, lastError);
        }

        console.log(`[Retry] Attempt ${attempt}/${maxAttempts} failed. Retrying in ${delay}ms...`);
        console.log(`[Retry] Error: ${lastError.message}`);

        await sleep(delay);
      }
    }
  }

  throw new Error(`Operation failed after ${maxAttempts} attempts: ${lastError!.message}`);
}

/**
 * Retry with specific error types
 */
export async function retryOnError<T>(
  fn: () => Promise<T>,
  errorTypes: Array<new (...args: any[]) => Error>,
  options: RetryOptions
): Promise<T> {
  return retry(async () => {
    try {
      return await fn();
    } catch (error) {
      const shouldRetry = errorTypes.some(ErrorType => error instanceof ErrorType);

      if (!shouldRetry) {
        // Don't retry, throw immediately
        throw error;
      }

      // Retry on this error
      throw error;
    }
  }, options);
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Default retry configurations
 */
export const RETRY_CONFIGS = {
  MCP_CALL: {
    maxAttempts: 3,
    delayMs: 1000,
    backoffMultiplier: 2,
  },
  AGENT_INVOKE: {
    maxAttempts: 2,
    delayMs: 2000,
    backoffMultiplier: 1.5,
  },
  SESSION_PERSIST: {
    maxAttempts: 5,
    delayMs: 500,
    backoffMultiplier: 1.2,
  },
} as const;
