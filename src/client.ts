import {
  buildJevRequest,
  DEFAULT_PROVIDER,
  parseJevResponse,
  PROVIDERS,
  type JevProvider,
} from './request.js';
import type { JevAsker, JevQuestions, JevResponse, JevState } from './types.js';

export interface JevClientOptions {
  /** Where Jev is served from. Defaults to `openrouter`. */
  provider?: JevProvider;
  /** Defaults to the provider's env var: `OPENROUTER_API_KEY` or `TYPESAFE_API_KEY`. */
  apiKey?: string;
  /** Defaults to the provider's model id: `~typesafe/jev-latest` or `jev-latest`. */
  model?: string;
  /** Defaults to the provider's decisions endpoint. */
  baseUrl?: string;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

/** Asks Jev over HTTP with the global `fetch` (or an injected one). */
export class JevClient implements JevAsker {
  private readonly provider: JevProvider;
  private readonly apiKey: string;
  private readonly model: string | undefined;
  private readonly baseUrl: string | undefined;
  private readonly fetcher: typeof fetch;

  constructor(options: JevClientOptions = {}) {
    this.provider = options.provider ?? DEFAULT_PROVIDER;
    this.apiKey = options.apiKey ?? process.env[PROVIDERS[this.provider].envKey] ?? '';
    this.model = options.model;
    this.baseUrl = options.baseUrl;
    this.fetcher = options.fetch ?? fetch;
  }

  async ask(state: JevState, questions: JevQuestions): Promise<JevResponse> {
    if (!this.apiKey) throw new Error(`${PROVIDERS[this.provider].envKey} is not configured`);
    const request = buildJevRequest(
      { apiKey: this.apiKey, model: this.model, baseUrl: this.baseUrl, provider: this.provider },
      state,
      questions,
    );
    const response = await this.fetcher(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
    return parseJevResponse(response.status, response.ok, await response.text());
  }
}
