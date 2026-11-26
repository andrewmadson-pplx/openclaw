import assert from "node:assert/strict";
import {
  createRuntimeEnv,
  registerSingleProviderPlugin,
  resolveProviderPluginChoice,
} from "openclaw/plugin-sdk/plugin-test-runtime";
import { resolveProviderRequestHeaders } from "openclaw/plugin-sdk/provider-http";
import { resolveAgentModelPrimaryValue } from "openclaw/plugin-sdk/provider-onboard";
import { expect, it, vi } from "vitest";
import { runSingleProviderCatalog } from "../test-support/provider-model-test-helpers.js";
import plugin from "./index.js";
import manifest from "./openclaw.plugin.json" with { type: "json" };

it("exposes Agent API models before credentials are configured", async () => {
  const provider = await registerSingleProviderPlugin(plugin);
  expect(provider.id).toBe("perplexity-agent");
  const catalog = await runSingleProviderCatalog({ catalog: provider.staticCatalog });
  expect(catalog).toMatchObject({
    api: "openai-responses",
    baseUrl: "https://api.perplexity.ai/v1",
  });
  expect(catalog.models.map((model) => model.id)).toEqual(["openai/gpt-5.5", "perplexity/sonar"]);
});

it("resolves model auth from the native key only", () => {
  expect(manifest.setup.providers).toContainEqual({
    id: "perplexity-agent",
    envVars: ["PERPLEXITY_API_KEY"],
  });
});

it("attributes native Agent API requests and withholds attribution from proxies", () => {
  const headers = (baseUrl: string) =>
    resolveProviderRequestHeaders({
      provider: "perplexity-agent",
      api: "openai-responses",
      baseUrl,
      capability: "llm",
      transport: "stream",
    });
  expect(headers("https://api.perplexity.ai/v1")).toHaveProperty("X-Pplx-Integration");
  expect(headers("https://proxy.example.com/v1")?.["X-Pplx-Integration"]).toBeUndefined();
});

it("onboards an API key without losing other provider configuration", async () => {
  const provider = await registerSingleProviderPlugin(plugin);
  const method = resolveProviderPluginChoice({
    providers: [provider],
    choice: "perplexity-agent-api-key",
  })?.method;
  assert(method?.runNonInteractive, "Missing Perplexity API-key onboarding");
  const config = {
    models: {
      mode: "replace" as const,
      providers: { existing: { baseUrl: "https://example.com/v1", models: [] } },
    },
  };
  const resolveApiKey = vi.fn(async () => ({ key: "synthetic-key", source: "profile" as const }));
  const result = await method.runNonInteractive({
    authChoice: "perplexity-agent-api-key",
    opts: { perplexityApiKey: "synthetic-key" },
    config,
    baseConfig: config,
    runtime: createRuntimeEnv(),
    resolveApiKey,
    toApiKeyCredential: () => null,
  });
  expect(resolveApiKey).toHaveBeenCalledWith({
    provider: "perplexity-agent",
    flagValue: "synthetic-key",
    flagName: "--perplexity-api-key",
    envVar: "PERPLEXITY_API_KEY",
  });
  expect(resolveAgentModelPrimaryValue(result?.agents?.defaults?.model)).toBe(
    "perplexity-agent/openai/gpt-5.5",
  );
  expect(result?.models?.providers?.existing).toEqual(config.models.providers.existing);
  expect(result?.models?.providers?.["perplexity-agent"]).toMatchObject({
    api: "openai-responses",
    baseUrl: "https://api.perplexity.ai/v1",
  });
});

it("adds properties to object schemas the Agent API would reject", async () => {
  const provider = await registerSingleProviderPlugin(plugin);
  const wellFormed = {
    name: "lookup",
    description: "Look up a value",
    parameters: { type: "object", properties: { query: { type: "string" } } },
  };
  const map = {
    name: "tag",
    description: "Tag a value",
    parameters: {
      type: "object",
      properties: {
        tags: { type: "object", additionalProperties: { type: "string" } },
        items: { type: "array", items: { anyOf: [{ type: "object" }, { type: "string" }] } },
      },
    },
  };
  const tools = provider.normalizeToolSchemas?.({
    provider: "perplexity-agent",
    tools: [wellFormed, map],
  } as never);
  assert(tools);
  expect(tools[0]).toBe(wellFormed);
  expect(tools[1]?.parameters).toEqual({
    type: "object",
    properties: {
      tags: { type: "object", properties: {}, additionalProperties: { type: "string" } },
      items: {
        type: "array",
        items: { anyOf: [{ type: "object", properties: {} }, { type: "string" }] },
      },
    },
  });
});
