import assert from "node:assert/strict";
import type { IncomingHttpHeaders } from "node:http";
import type { MemoryEmbeddingProviderCreateOptions } from "openclaw/plugin-sdk/memory-core-host-engine-embeddings";
import { withServer } from "openclaw/plugin-sdk/test-env";
import { expect, it } from "vitest";
import {
  parsePerplexityEmbeddingPayload,
  perplexityMemoryEmbeddingProviderAdapter,
} from "./memory-embedding-adapter.js";

function int8(values: number[]): string {
  return Buffer.from(Int8Array.from(values).buffer).toString("base64");
}

function create(remote: MemoryEmbeddingProviderCreateOptions["remote"] = {}) {
  return perplexityMemoryEmbeddingProviderAdapter.create({
    config: {},
    provider: "perplexity",
    model: "pplx-embed-v1-0.6b",
    fallback: "none",
    remote: { apiKey: "fixture-perplexity-key", ...remote },
  });
}

it.each([undefined, "https://API.PERPLEXITY.AI:443/v1/"])(
  "default identity: %s",
  async (baseUrl) => {
    expect((await create({ baseUrl })).runtime?.cacheKeyData).toEqual({
      provider: "perplexity",
      model: "pplx-embed-v1-0.6b",
    });
  },
);

it("strips the provider prefix from the configured model", async () => {
  const { provider } = await perplexityMemoryEmbeddingProviderAdapter.create({
    config: {},
    provider: "perplexity",
    model: "perplexity/pplx-embed-v1-4b",
    fallback: "none",
    remote: { apiKey: "fixture-perplexity-key" },
  });
  expect(provider?.model).toBe("pplx-embed-v1-4b");
});

it("decodes base64 int8 vectors in index order", async () => {
  let headers: IncomingHttpHeaders = {};
  let body: unknown;
  await withServer(
    (request, response) => {
      headers = request.headers;
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            data: [
              { index: 1, embedding: int8([0, -4, 3]) },
              { index: 0, embedding: int8([3, 4, 0]) },
            ],
          }),
        );
      });
    },
    async (origin) => {
      const { provider } = await create({ baseUrl: `${origin}/v1` });
      assert(provider, "expected configured Perplexity embedding provider");
      await expect(provider.embedBatch(["first", "second"])).resolves.toEqual([
        [0.6, 0.8, 0],
        [0, -0.8, 0.6],
      ]);
    },
  );
  expect(body).toEqual({
    model: "pplx-embed-v1-0.6b",
    input: ["first", "second"],
    encoding_format: "base64_int8",
  });
  expect(headers.authorization).toBe("Bearer fixture-perplexity-key");
  expect(headers["x-pplx-integration"]).toBeUndefined();
});

it("partitions custom endpoints without caching the API key", async () => {
  const identity = (await create({ baseUrl: "https://proxy.example.test/v1" })).runtime
    ?.cacheKeyData;
  expect(identity).toMatchObject({ baseUrl: "https://proxy.example.test/v1" });
  expect(JSON.stringify(identity)).not.toContain("fixture-");
});

it("rejects OpenRouter keys instead of sending them to the Perplexity API", async () => {
  await expect(create({ apiKey: "sk-or-fixture" })).rejects.toThrow(
    "OpenRouter keys are not supported",
  );
});

it.each([
  [{ data: [] }, "expected 1 vectors"],
  [{ data: [{ index: 3, embedding: int8([1]) }] }, "invalid index"],
  [{ data: [{ index: 0, embedding: [1, 2] }] }, "missing base64 embedding at index 0"],
])("rejects malformed payloads: %j", (payload, message) => {
  expect(() => parsePerplexityEmbeddingPayload(payload, 1)).toThrow(message);
});
