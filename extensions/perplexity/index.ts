import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { perplexityMemoryEmbeddingProviderAdapter } from "./memory-embedding-adapter.js";
import { createPerplexityWebSearchProvider } from "./src/perplexity-web-search-provider.js";

export default definePluginEntry({
  id: "perplexity",
  name: "Perplexity Plugin",
  description: "Bundled Perplexity plugin",
  register(api) {
    api.registerEmbeddingProvider(perplexityMemoryEmbeddingProviderAdapter);
    api.registerWebSearchProvider(createPerplexityWebSearchProvider());
  },
});
