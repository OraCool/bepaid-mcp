// Thin fetch wrapper for the bePaid APIs. All hosts use HTTP Basic auth with shop_id:secret_key.

export const BEPAID_HOSTS = {
  reports: "https://merchant.bepaid.by",
  gateway: "https://gateway.bepaid.by",
  checkout: "https://checkout.bepaid.by",
} as const;

export interface BepaidCredentials {
  shopId: string;
  secretKey: string;
}

export class BepaidError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "BepaidError";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST";
  apiVersion?: string;
  body?: unknown;
}

export type FetchLike = typeof fetch;

export class BepaidClient {
  constructor(
    private readonly credentials: BepaidCredentials | undefined,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async request<T = unknown>(baseUrl: string, path: string, options: RequestOptions = {}): Promise<T> {
    if (!this.credentials) {
      throw new BepaidError(
        "bePaid credentials are not configured: set BEPAID_SHOP_ID and BEPAID_SECRET_KEY",
        0,
      );
    }
    const { shopId, secretKey } = this.credentials;
    const basic = Buffer.from(shopId + ":" + secretKey).toString("base64");
    const headers: Record<string, string> = {
      Authorization: `Basic ${basic}`,
      Accept: "application/json",
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.apiVersion) headers["X-Api-Version"] = options.apiVersion;

    const response = await this.fetchImpl(`${baseUrl}${path}`, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const text = await response.text();
    const data = text ? safeJson(text) : undefined;
    if (!response.ok) {
      throw new BepaidError(describeError(response.status, data, text), response.status, data);
    }
    return data as T;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// bePaid errors look like {"message": "...", "errors": {"field": ["is invalid"]}} (422),
// or {"response": {"message": "..."}} on the gateway.
function describeError(status: number, data: unknown, raw: string): string {
  if (data && typeof data === "object") {
    const obj = data as Record<string, any>;
    const message = obj.message ?? obj.response?.message ?? obj.error;
    const fields = obj.errors && typeof obj.errors === "object" ? ` ${JSON.stringify(obj.errors)}` : "";
    if (message) return `bePaid ${status}: ${message}${fields}`;
  }
  return `bePaid ${status}: ${raw.slice(0, 300) || "empty response"}`;
}
