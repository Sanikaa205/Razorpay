import https from 'https';

const GEMINI_MODEL_ID = 'gemini-3.6-flash';
const REQUEST_TIMEOUT_MS = 45000;

/**
 * Minimal REST client for Gemini's generateContent endpoint using Node's
 * classic `https` module. Both the `@google/genai` SDK and the global
 * `fetch` (undici) hang indefinitely against this API host in this
 * environment - reproduced with plain `fetch` and no schema involved, so
 * it's a transport-level issue, not anything about our request payload.
 * `https.request` reaches the same endpoint reliably.
 *
 * Single attempt, no client-side retry: the free tier's daily request quota
 * is tight enough (20/day at time of writing) that retrying on every
 * transient hiccup would burn through it twice as fast. The caller
 * (`getStoreAiResponse`) instead falls back to the keyword matcher on any
 * failure here - quota exhaustion, a timeout, or a real API error - so a
 * buyer never sees a hard failure either way.
 */
export function generateGeminiContent(params: {
  systemInstruction: string;
  userText: string;
  responseSchema: object;
}): Promise<string> {
  const { systemInstruction, userText, responseSchema } = params;
  const apiKey = process.env.GEMINI_API_KEY;

  const payload = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema,
      // Keeps latency down for this straightforward grounded-extraction
      // task; gemini-3.6-flash requires a non-zero thinking budget.
      thinkingConfig: { thinkingBudget: 128 },
    },
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/${GEMINI_MODEL_ID}:generateContent?key=${apiKey}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Gemini API error ${res.statusCode}: ${data}`));
            return;
          }
          try {
            const body = JSON.parse(data);
            const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
            resolve(typeof text === 'string' ? text : '');
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Gemini request timed out'));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}
