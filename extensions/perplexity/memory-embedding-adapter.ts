import {
  embeddingProviderOwnsDestination,
  normalizeEmbeddingModelWithPrefixes,
  resolveEmbeddingEndpointUrl,
  resolveRemoteEmbeddingClient,
  sanitizeAndNormalizeEmbedding,
  sanitizeEmbeddingCacheHeaders,
  withRemoteHttpResponse,
  type MemoryEmbeddingProvider,
  type MemoryEmbeddingProviderAdapter,
  type MemoryEmbeddingProviderCallOptions,
  type MemoryEmbeddingProviderCreateOptions,
} from "openclaw/plugin-sdk/memory-core-host-engine-embeddings";
import {
  createProviderHttpError,
  readProviderJsonResponse,
  resolveProviderRequestHeaders,
} from "openclaw/plugin-sdk/provider-http";
import { omitNullRequestHeaders } from "openclaw/plugin-sdk/provider-request-headers";
import { asOptionalObjectRecord } from "openclaw/plugin-sdk/string-coerce-runtime";

const DEFAULT_PERPLEXITY_EMBEDDING_MODEL = "pplx-embed-v1-0.6b";
const PERPLEXITY_BASE_URL = "https://api.perplexity.ai/v1";
const PERPLEXITY_EMBEDDINGS_ERROR_PREFIX = "perplexity embeddings failed";
const EXCLUDED_EMBEDDING_HEADERS = ["authorization", "content-type", "x-api-key", "api-key"];

// The Embeddings API returns each vector as base64-encoded signed int8 values.
function decodeBase64Int8(value: string): number[] {
  const bytes = Buffer.from(value, "base64");
  return Array.from(new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}

export function parsePerplexityEmbeddingPayload(
  payload: unknown,
  expectedCount: number,
): number[][] {
  const invalid = (condition: string) =>
    new Error(`${PERPLEXITY_EMBEDDINGS_ERROR_PREFIX}: ${condition}`);
  const data = asOptionalObjectRecord(payload)?.data;
  if (!Array.isArray(data) || data.length !== expectedCount) {
    throw invalid(`expected ${expectedCount} vectors`);
  }
  const vectors = Array.from<number[] | undefined>({ length: expectedCount });
  for (const entry of data) {
    const record = asOptionalObjectRecord(entry);
    const index = record?.index;
    if (
      typeof index !== "number" ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= expectedCount
    ) {
      throw invalid("invalid index");
    }
    if (vectors[index] !== undefined) {
      throw invalid(`duplicate index ${index}`);
    }
    if (typeof record?.embedding !== "string" || record.embedding.length === 0) {
      throw invalid(`missing base64 embedding at index ${index}`);
    }
    vectors[index] = sanitizeAndNormalizeEmbedding(decodeBase64Int8(record.embedding));
  }
  return vectors as number[][];
}

export const perplexityMemoryEmbeddingProviderAdapter: MemoryEmbeddingProviderAdapter = {
  id: "perplexity",
  defaultModel: DEFAULT_PERPLEXITY_EMBEDDING_MODEL,
  transport: "remote",
  authProviderId: "perplexity",
  create: async (options) => {
    const preparedOptions: MemoryEmbeddingProviderCreateOptions = {
      ...options,
      provider: "perplexity",
      fallback: "none",
    };
    const client = await resolveRemoteEmbeddingClient({
      provider: "perplexity",
      options: preparedOptions,
      defaultBaseUrl: PERPLEXITY_BASE_URL,
      normalizeModel: (model) =>
        normalizeEmbeddingModelWithPrefixes({
          model,
          defaultModel: DEFAULT_PERPLEXITY_EMBEDDING_MODEL,
          prefixes: ["perplexity/"],
        }),
    });
    const authorization = Object.entries(client.headers).find(
      ([name]) => name.toLowerCase() === "authorization",
    )?.[1];
    if (authorization?.toLowerCase().startsWith("bearer sk-or-")) {
      throw new Error(
        `${PERPLEXITY_EMBEDDINGS_ERROR_PREFIX}: OpenRouter keys are not supported; set PERPLEXITY_API_KEY`,
      );
    }
    const usesDefaultEndpoint = embeddingProviderOwnsDestination({
      baseUrl: client.baseUrl,
      providerBaseUrl: PERPLEXITY_BASE_URL,
    });
    const url = resolveEmbeddingEndpointUrl(client.baseUrl, "embeddings");
    const requestHeaders =
      omitNullRequestHeaders(
        resolveProviderRequestHeaders({
          provider: "perplexity",
          // Attribution applies only on the direct Perplexity API, as in web search.
          baseUrl: usesDefaultEndpoint ? undefined : client.baseUrl,
          capability: "other",
          transport: "http",
          defaultHeaders: client.headers,
        }),
      ) ?? client.headers;
    const embedMany = async (
      input: string[],
      callOptions?: MemoryEmbeddingProviderCallOptions,
    ): Promise<number[][]> => {
      if (input.length === 0) {
        return [];
      }
      return await withRemoteHttpResponse({
        url,
        fetchImpl: client.fetchImpl,
        ssrfPolicy: client.ssrfPolicy,
        resolveRequestHeaders: client.resolveRequestHeaders,
        signal: callOptions?.signal,
        init: {
          method: "POST",
          headers: requestHeaders,
          body: JSON.stringify({ model: client.model, input, encoding_format: "base64_int8" }),
        },
        onResponse: async (response, sentHeaders) => {
          if (!response.ok) {
            throw await createProviderHttpError(response, PERPLEXITY_EMBEDDINGS_ERROR_PREFIX, {
              requestHeaders: sentHeaders,
              signal: callOptions?.signal,
              maxBodyBytes: 8 * 1024,
            });
          }
          const payload = await readProviderJsonResponse(response, "perplexity.embeddings");
          return parsePerplexityEmbeddingPayload(payload, input.length);
        },
      });
    };
    const provider: MemoryEmbeddingProvider = {
      id: "perplexity",
      model: client.model,
      embed: async (input, callOptions) => {
        const [vector] = await embedMany(
          [typeof input === "string" ? input : input.text],
          callOptions,
        );
        return vector ?? [];
      },
      embedBatch: async (inputs, callOptions) =>
        await embedMany(
          inputs.map((input) => (typeof input === "string" ? input : input.text)),
          callOptions,
        ),
    };
    const headers = sanitizeEmbeddingCacheHeaders(client.headers, EXCLUDED_EMBEDDING_HEADERS);
    const usesDefaultIdentity = headers.length === 0 && usesDefaultEndpoint;
    return {
      provider,
      runtime: {
        id: "perplexity",
        cacheKeyData: {
          provider: "perplexity",
          model: client.model,
          ...(usesDefaultIdentity ? {} : { baseUrl: client.baseUrl, headers }),
        },
      },
    };
  },
};
