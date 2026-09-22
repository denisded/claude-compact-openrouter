import type { JevAnswer, JevQuestions, JevResponse, JevState } from './types.js';

export type JevProvider = 'openrouter' | 'typesafe';

/** Where Jev is served from: the decisions endpoint, the model id there and the key's env var. */
export const PROVIDERS: Record<JevProvider, { url: string; model: string; envKey: string }> = {
  openrouter: {
    url: 'https://openrouter.ai/api/alpha/decisions',
    model: '~typesafe/jev-latest',
    envKey: 'OPENROUTER_API_KEY',
  },
  typesafe: {
    url: 'https://api.typesafe.ai/v1/systemone',
    model: 'jev-latest',
    envKey: 'TYPESAFE_API_KEY',
  },
};

export const DEFAULT_PROVIDER: JevProvider = 'openrouter';
export const DECISIONS_URL = PROVIDERS.openrouter.url;
export const DEFAULT_MODEL = PROVIDERS.openrouter.model;

export function isJevProvider(value: unknown): value is JevProvider {
  return typeof value === 'string' && Object.hasOwn(PROVIDERS, value);
}

export interface JevRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
}

/** The HTTP request for one Jev call, for any fetch-like transport. */
export function buildJevRequest(
  params: {
    apiKey: string;
    model?: string;
    baseUrl?: string;
    provider?: JevProvider;
  },
  state: JevState,
  questions: JevQuestions,
): JevRequest {
  const provider = PROVIDERS[params.provider ?? DEFAULT_PROVIDER];
  return {
    url: params.baseUrl ?? provider.url,
    method: 'POST',
    headers: {
      authorization: `Bearer ${params.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: params.model ?? provider.model,
      state,
      questions,
    }),
  };
}

/** Validates a Jev response body; throws on anything but an `answers` object. */
export function parseJevResponse(
  status: number,
  ok: boolean,
  text: string,
): JevResponse {
  if (!ok) {
    throw new Error(`Jev request failed (${status}): ${text.slice(0, 200)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Jev returned malformed JSON');
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    !('answers' in parsed) ||
    parsed.answers === null ||
    typeof parsed.answers !== 'object'
  ) {
    throw new Error('Jev response is missing answers');
  }
  return parsed as JevResponse;
}

/** The `noul` probability of one answer; throws when it is not there. */
export function noulAnswer(
  answers: Record<string, JevAnswer>,
  name: string,
): number {
  const answer = answers[name];
  if (
    !answer ||
    !('noul' in answer) ||
    typeof answer.noul !== 'number' ||
    !Number.isFinite(answer.noul)
  ) {
    throw new Error(`Invalid Jev answer for ${name}`);
  }
  return answer.noul;
}
