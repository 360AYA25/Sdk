/**
 * External Tester
 * Tests workflow via Telegram webhook
 */

export interface ExternalTestRequest {
  message: string;
  expectedPattern?: string;
}

export interface ExternalTestResult {
  success: boolean;
  response?: string;
  error?: string;
}

export async function runExternalTest(
  request: ExternalTestRequest
): Promise<ExternalTestResult> {
  const webhookUrl = process.env.EXTERNAL_TEST_WEBHOOK_URL;
  const botUsername = process.env.EXTERNAL_TEST_BOT_USERNAME ?? '@Multi_Bot0101_bot';
  const timeout = parseInt(process.env.EXTERNAL_TEST_TIMEOUT ?? '20000', 10);

  if (!webhookUrl) {
    console.log('[ExternalTest] Not configured, skipping');
    return { success: true }; // Skip if not configured
  }

  // Retry logic
  const maxRetries = 3;
  let lastError = '';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[ExternalTest] Attempt ${attempt}/${maxRetries}: ${request.message}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bot_username: botUsername,
          message: request.message,
          scope: 'sdk_fix_validation',
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json() as {
        failed?: number;
        results?: Array<{
          error?: string;
          response_received?: string;
        }>;
      };

      // Check result
      if (data.failed && data.failed > 0) {
        throw new Error(`Test failed: ${data.results?.[0]?.error ?? 'unknown'}`);
      }

      // Validate pattern if provided
      if (request.expectedPattern && data.results?.[0]?.response_received) {
        const regex = new RegExp(request.expectedPattern, 'i');
        if (!regex.test(data.results[0].response_received)) {
          throw new Error(`Response didn't match pattern: ${request.expectedPattern}`);
        }
      }

      return {
        success: true,
        response: data.results?.[0]?.response_received,
      };
    } catch (error) {
      lastError = (error as Error).message;
      console.error(`[ExternalTest] Attempt ${attempt} failed:`, lastError);

      if (attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
      }
    }
  }

  return {
    success: false,
    error: `Failed after ${maxRetries} attempts: ${lastError}`,
  };
}
