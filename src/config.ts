export interface Config {
  baseUrl: string;
  apiKey?: string;
}

export const DEFAULT_BASE_URL = "https://proofread.law";

/** Reads PROOFREAD_API (base URL) and PROOFREAD_API_KEY (an account key, any plan) from the environment. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): Config {
  const baseUrl = (env.PROOFREAD_API ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const apiKey = env.PROOFREAD_API_KEY?.trim();
  return apiKey ? { baseUrl, apiKey } : { baseUrl };
}
